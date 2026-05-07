using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Storage.Blobs;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Formats.Jpeg;
using SixLabors.ImageSharp.Processing;
using ListFlair.Api.Models;

namespace ListFlair.Api.Services;

public class ImageLookupService : IImageLookupService
{
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _config;
    private readonly bool _useBlobStorage;
    private readonly string? _storageConnectionString;
    private readonly string _storageContainer;
    private BlobContainerClient? _containerClient;
    private readonly SemaphoreSlim _containerLock = new(1, 1);

    private const string OpenverseApiUrl = "https://api.openverse.org/v1/images/";
    private const int ImagePageSize = 16;
    private const int OutputWidth = 640;
    private const int OutputHeight = 480;
    private const string GeneratedImageUrlPrefix = "/generated-images";

    private static readonly Dictionary<string, string[]> CategoryQueryHints = new()
    {
        ["film"] = ["movie", "poster", "still", "cinema"],
        ["movie"] = ["film", "poster", "still", "cinema"],
        ["music"] = ["band", "musician", "logo", "album cover"],
        ["movies"] = ["film", "poster", "still"],
        ["sports"] = ["athlete", "team", "action"],
        ["gaming"] = ["game", "character", "art"]
    };

    private static readonly Dictionary<string, string> TagAliases = new()
    {
        ["films"] = "film",
        ["movie"] = "film",
        ["movies"] = "film",
        ["cinema"] = "film",
        ["motionpicture"] = "film",
        ["motionpictures"] = "film"
    };

    public string GeneratedImageDir { get; }

    public ImageLookupService(IHttpClientFactory httpClientFactory, IConfiguration config)
    {
        _httpClientFactory = httpClientFactory;
        _config = config;
        _storageConnectionString = config["AZURE_STORAGE_CONNECTION_STRING"]
            ?? Environment.GetEnvironmentVariable("AZURE_STORAGE_CONNECTION_STRING");
        _useBlobStorage = !string.IsNullOrEmpty(_storageConnectionString);
        _storageContainer = config["StorageContainer"]
            ?? Environment.GetEnvironmentVariable("AZURE_STORAGE_CONTAINER")
            ?? "generated-images";

        var repoRoot = config["RepoRoot"]
            ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        GeneratedImageDir = Path.Combine(repoRoot, "data", "generated-images");
    }

    // ──────────────────────────────────────────────────────────────
    // Tag parsing / query building
    // ──────────────────────────────────────────────────────────────

    private static List<string> ParseTags(string? value)
    {
        return (value ?? "")
            .Split([';', ',', '|', '/'], StringSplitOptions.RemoveEmptyEntries)
            .Select(t => t.Trim())
            .Where(t => !string.IsNullOrEmpty(t))
            .Take(8)
            .ToList();
    }

    private static string NormaliseTag(string tag)
    {
        var token = new string(tag.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
        return TagAliases.TryGetValue(token, out var alias) ? alias : token;
    }

    private static List<string> BuildQueries(Entry entry)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queries = new List<string>();

        void Add(string q) { if (seen.Add(q)) queries.Add(q); }

        var name = entry.Name.Trim();
        var tags = ParseTags(entry.Category);
        var tagsPhrase = string.Join(" ", tags).Trim();
        var canonicalTags = tags.Select(NormaliseTag).Where(t => !string.IsNullOrEmpty(t)).Distinct().ToList();
        var hintTags = canonicalTags.Count > 0 ? canonicalTags : [NormaliseTag(entry.Category.Trim())];
        var hints = hintTags.SelectMany(t => CategoryQueryHints.TryGetValue(t, out var h) ? h : []).ToList();

        if (!string.IsNullOrEmpty(name) && !string.IsNullOrEmpty(tagsPhrase))
        {
            Add($"{name} {tagsPhrase}");
            Add($"\"{name}\" {tagsPhrase}");
        }

        foreach (var tag in tags)
        {
            Add($"{name} {tag}");
            Add($"\"{name}\" {tag}");
        }

        foreach (var hint in hints)
        {
            Add($"{name} {hint}");
            Add($"\"{name}\" {hint}");
        }

        if (!string.IsNullOrEmpty(name)) Add(name);

        return queries;
    }

    // ──────────────────────────────────────────────────────────────
    // Candidate scoring
    // ──────────────────────────────────────────────────────────────

    private static List<string> Tokenize(string? value)
    {
        return (value ?? "")
            .ToLowerInvariant()
            .Split(c => !char.IsLetterOrDigit(c), StringSplitOptions.RemoveEmptyEntries)
            .Where(t => t.Length > 1)
            .ToList();
    }

    private static string GetCandidateText(OpenverseCandidate c)
    {
        var parts = new List<string?> { c.Title, c.Creator, c.Source };
        parts.AddRange(c.Tags?.Select(t => t.Name) ?? []);
        return string.Join(" ", parts.Where(p => !string.IsNullOrEmpty(p))).ToLowerInvariant();
    }

    private static int GetCandidateScore(OpenverseCandidate candidate, Entry entry, string query)
    {
        var haystack = GetCandidateText(candidate);
        var namePhrase = entry.Name.ToLowerInvariant();
        var categoryPhrase = entry.Category.ToLowerInvariant();
        var queryTokens = Tokenize(query);
        var nameTokens = Tokenize(entry.Name);
        var categoryTokens = Tokenize(entry.Category);
        var score = 0;

        if (haystack.Contains(namePhrase)) score += 50;
        if (!string.IsNullOrEmpty(categoryPhrase) && haystack.Contains(categoryPhrase)) score += 16;

        foreach (var t in queryTokens) if (haystack.Contains(t)) score += 8;

        var nameHits = nameTokens.Count(t => haystack.Contains(t));
        score += nameHits * 10;
        var catHits = categoryTokens.Count(t => haystack.Contains(t));
        score += catHits * 4;

        if (nameTokens.Count > 0 && nameHits == 0) score -= 40;
        if (categoryTokens.Count > 0 && catHits == 0) score -= 8;

        var width = candidate.Width;
        var height = candidate.Height;
        if (width >= 400 && height >= 300) score += 18;
        if (width > 0 && height > 0)
        {
            var areaScore = (int)Math.Min((double)width * height / 250000.0, 18.0);
            var ratio = (double)width / height;
            var ratioScore = (int)Math.Max(0.0, 10.0 - Math.Abs(ratio - 1.2) * 10.0);
            score += areaScore + ratioScore;
        }

        var title = (candidate.Title ?? "").ToLowerInvariant();
        if (System.Text.RegularExpressions.Regex.IsMatch(title, @"(stock|vector|illustration|clipart|template|background|icon)"))
            score -= 20;
        if (System.Text.RegularExpressions.Regex.IsMatch(haystack, @"(stock|vector|illustration|clipart|template|background)"))
            score -= 18;

        if (categoryPhrase == "music")
        {
            if (System.Text.RegularExpressions.Regex.IsMatch(haystack, @"(band|musician|artist|album|cover|logo)"))
                score += 16;
            if (System.Text.RegularExpressions.Regex.IsMatch(haystack, @"(music background|musical background|abstract music|equalizer)"))
                score -= 20;
        }

        if (string.IsNullOrEmpty(candidate.Url) && string.IsNullOrEmpty(candidate.Thumbnail))
            score -= 100;

        return score;
    }

    // ──────────────────────────────────────────────────────────────
    // Openverse search
    // ──────────────────────────────────────────────────────────────

    private async Task<List<RankedCandidate>> SearchOpenverseAsync(Entry entry)
    {
        var ranked = new List<RankedCandidate>();
        var seen = new HashSet<string>();
        var client = _httpClientFactory.CreateClient("openverse");

        foreach (var query in BuildQueries(entry))
        {
            HttpResponseMessage response;
            try
            {
                response = await client.GetAsync(
                    $"{OpenverseApiUrl}?q={Uri.EscapeDataString(query)}&page_size={ImagePageSize}");
            }
            catch { continue; }

            if (!response.IsSuccessStatusCode) continue;

            var json = await response.Content.ReadAsStringAsync();
            var payload = JsonSerializer.Deserialize<OpenverseResponse>(json, JsonOpts);
            if (payload?.Results == null) continue;

            foreach (var candidate in payload.Results)
            {
                var dedupeKey = candidate.Id ?? candidate.ForeignLandingUrl ?? candidate.Url ?? candidate.Thumbnail;
                if (string.IsNullOrEmpty(dedupeKey) || !seen.Add(dedupeKey)) continue;

                ranked.Add(new RankedCandidate
                {
                    Query = query,
                    Score = GetCandidateScore(candidate, entry, query),
                    FetchUrl = candidate.Url ?? candidate.Thumbnail ?? "",
                    ThumbnailUrl = candidate.Thumbnail ?? candidate.Url,
                    SourceUrl = candidate.ForeignLandingUrl ?? candidate.Url
                });
            }
        }

        ranked.Sort((a, b) => b.Score.CompareTo(a.Score));
        return ranked;
    }

    // ──────────────────────────────────────────────────────────────
    // Image caching
    // ──────────────────────────────────────────────────────────────

    private async Task<BlobContainerClient?> GetContainerClientAsync()
    {
        if (!_useBlobStorage) return null;
        if (_containerClient != null) return _containerClient;

        await _containerLock.WaitAsync();
        try
        {
            if (_containerClient != null) return _containerClient;
            var blobService = new BlobServiceClient(_storageConnectionString);
            _containerClient = blobService.GetBlobContainerClient(_storageContainer);
            await _containerClient.CreateIfNotExistsAsync(Azure.Storage.Blobs.Models.PublicAccessType.Blob);
            return _containerClient;
        }
        finally { _containerLock.Release(); }
    }

    private async Task<byte[]> DownloadBufferAsync(string url)
    {
        var client = _httpClientFactory.CreateClient("imagedownload");
        var response = await client.GetAsync(url);
        if (!response.IsSuccessStatusCode)
            throw new InvalidOperationException($"Image download failed with status {(int)response.StatusCode}");
        return await response.Content.ReadAsByteArrayAsync();
    }

    private async Task<byte[]> TransformImageAsync(byte[] input)
    {
        using var image = Image.Load(input);
        image.Mutate(ctx => ctx
            .AutoOrient()
            .Resize(new ResizeOptions
            {
                Mode = ResizeMode.Max,
                Size = new Size(OutputWidth, OutputHeight),
                Sampler = SixLabors.ImageSharp.Processing.Processors.Transforms.LanczosResampler.Lanczos3
            }));

        using var ms = new MemoryStream();
        await image.SaveAsync(ms, new JpegEncoder { Quality = 82 });
        return ms.ToArray();
    }

    private async Task<CachedImage> CacheImageLocallyAsync(Entry entry, RankedCandidate candidate)
    {
        byte[] imageBuffer;
        try { imageBuffer = await DownloadBufferAsync(candidate.FetchUrl); }
        catch
        {
            if (string.IsNullOrEmpty(candidate.ThumbnailUrl) || candidate.ThumbnailUrl == candidate.FetchUrl)
                throw;
            imageBuffer = await DownloadBufferAsync(candidate.ThumbnailUrl);
        }

        var hash = Convert.ToHexString(SHA1.HashData(
            System.Text.Encoding.UTF8.GetBytes($"{entry.Id}:{candidate.FetchUrl}:{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}")))
            .ToLowerInvariant()[..12];
        var fileName = $"{entry.Id}-{hash}.jpg";
        var transformed = await TransformImageAsync(imageBuffer);

        if (_useBlobStorage)
        {
            var container = await GetContainerClientAsync();
            var blob = container!.GetBlobClient(fileName);
            using var ms = new MemoryStream(transformed);
            await blob.UploadAsync(ms, new Azure.Storage.Blobs.Models.BlobUploadOptions
            {
                HttpHeaders = new Azure.Storage.Blobs.Models.BlobHttpHeaders { ContentType = "image/jpeg" }
            });
            return new CachedImage { ImageUrl = blob.Uri.ToString(), ImageSource = candidate.SourceUrl, ImageQuery = candidate.Query };
        }

        Directory.CreateDirectory(GeneratedImageDir);
        var filePath = Path.Combine(GeneratedImageDir, fileName);
        await File.WriteAllBytesAsync(filePath, transformed);
        return new CachedImage
        {
            ImageUrl = $"{GeneratedImageUrlPrefix}/{fileName}",
            ImageSource = candidate.SourceUrl,
            ImageQuery = candidate.Query
        };
    }

    // ──────────────────────────────────────────────────────────────
    // Public interface
    // ──────────────────────────────────────────────────────────────

    public async Task<CachedImage> FindAndCacheImageForEntryAsync(Entry entry, int requestedIndex = 0)
    {
        var candidates = await SearchOpenverseAsync(entry);
        if (candidates.Count == 0)
            throw new InvalidOperationException("No suitable image found");

        var safeIndex = Math.Max(0, requestedIndex);
        var candidate = candidates[safeIndex % candidates.Count];
        var cached = await CacheImageLocallyAsync(entry, candidate);
        cached.ImageResultIndex = safeIndex % candidates.Count;
        return cached;
    }

    public async Task<CachedImage> CacheSelectedImageAsync(Entry entry, string fetchUrl,
        string? thumbnailUrl, string? sourceUrl, string? query)
    {
        return await CacheImageLocallyAsync(entry, new RankedCandidate
        {
            FetchUrl = fetchUrl,
            ThumbnailUrl = thumbnailUrl ?? fetchUrl,
            SourceUrl = sourceUrl,
            Query = query ?? ""
        });
    }

    public async Task<List<WebImageResult>> SearchWebImagesAsync(string query)
    {
        var client = _httpClientFactory.CreateClient("duckduckgo");

        // Step 1: Get vqd token
        var pageResp = await client.GetAsync(
            $"https://duckduckgo.com/?q={Uri.EscapeDataString(query)}&iax=images&ia=images");
        if (!pageResp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Image search unavailable ({(int)pageResp.StatusCode})");

        var html = await pageResp.Content.ReadAsStringAsync();
        var vqdMatch = System.Text.RegularExpressions.Regex.Match(html, @"vqd=['""]([^'""]+)['""]");
        if (!vqdMatch.Success)
            vqdMatch = System.Text.RegularExpressions.Regex.Match(html, @"""vqd"":""([^""]+)""");
        if (!vqdMatch.Success)
            vqdMatch = System.Text.RegularExpressions.Regex.Match(html, @"vqd=([a-zA-Z0-9_-]+)");
        if (!vqdMatch.Success)
            throw new InvalidOperationException("Image search temporarily unavailable");

        var vqd = vqdMatch.Groups[1].Value;

        // Step 2: Fetch images
        var imagesUrl = new UriBuilder("https://duckduckgo.com/i.js");
        imagesUrl.Query = $"q={Uri.EscapeDataString(query)}&vqd={Uri.EscapeDataString(vqd)}&p=1&s=0&l=us-en&f=,,,,,";
        var imgResp = await client.GetAsync(imagesUrl.Uri);
        if (!imgResp.IsSuccessStatusCode)
            throw new InvalidOperationException($"Image search failed ({(int)imgResp.StatusCode})");

        var json = await imgResp.Content.ReadAsStringAsync();
        var data = JsonSerializer.Deserialize<DdgImageResponse>(json, JsonOpts);

        return (data?.Results ?? [])
            .Select(r => new WebImageResult
            {
                Title = r.Title ?? "",
                ThumbnailUrl = NormaliseResultUrl(r.Thumbnail ?? r.Image),
                FetchUrl = NormaliseResultUrl(r.Image ?? r.Thumbnail),
                SourceUrl = NormaliseResultUrl(r.Url)
            })
            .Where(r => !string.IsNullOrEmpty(r.ThumbnailUrl) || !string.IsNullOrEmpty(r.FetchUrl))
            .Take(24)
            .ToList();
    }

    private static string? NormaliseResultUrl(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var t = url.Trim();
        if (t.StartsWith("//")) return "https:" + t;
        if (t.StartsWith("http://")) return "https://" + t["http://".Length..];
        if (t.StartsWith("https://")) return t;
        return null;
    }

    public bool IsGeneratedImageUrl(string? imageUrl)
    {
        if (string.IsNullOrEmpty(imageUrl)) return false;
        if (imageUrl.StartsWith($"{GeneratedImageUrlPrefix}/")) return true;
        if (_useBlobStorage) return imageUrl.Contains($"/{_storageContainer}/");
        return false;
    }

    public async Task RemoveCachedImageAsync(string? imageUrl)
    {
        if (!IsGeneratedImageUrl(imageUrl)) return;

        if (_useBlobStorage && imageUrl!.StartsWith("http"))
        {
            try
            {
                var uri = new Uri(imageUrl);
                var pathParts = uri.AbsolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
                var containerIndex = Array.IndexOf(pathParts, _storageContainer);
                if (containerIndex >= 0 && pathParts.Length > containerIndex + 1)
                {
                    var blobName = string.Join("/", pathParts[(containerIndex + 1)..]);
                    var container = await GetContainerClientAsync();
                    await container!.DeleteBlobIfExistsAsync(blobName,
                        Azure.Storage.Blobs.Models.DeleteSnapshotsOption.IncludeSnapshots);
                }
            }
            catch { /* best effort */ }
            return;
        }

        var fileName = imageUrl!.Replace($"{GeneratedImageUrlPrefix}/", "");
        var filePath = Path.Combine(GeneratedImageDir, fileName);
        try { File.Delete(filePath); }
        catch (FileNotFoundException) { }
    }

    // ──────────────────────────────────────────────────────────────
    // Internal types
    // ──────────────────────────────────────────────────────────────

    private sealed class RankedCandidate
    {
        public string Query { get; set; } = "";
        public int Score { get; set; }
        public string FetchUrl { get; set; } = "";
        public string? ThumbnailUrl { get; set; }
        public string? SourceUrl { get; set; }
    }

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private sealed class OpenverseResponse
    {
        public List<OpenverseCandidate>? Results { get; set; }
    }

    private sealed class DdgImageResponse
    {
        public List<DdgImageResult>? Results { get; set; }
    }

    private sealed class DdgImageResult
    {
        public string? Image { get; set; }
        public string? Thumbnail { get; set; }
        public string? Url { get; set; }
        public string? Title { get; set; }
    }
}

// Extension for string.Split with char predicate (used in Tokenize)
internal static class StringExtensions
{
    public static string[] Split(this string source, Func<char, bool> predicate,
        StringSplitOptions options = StringSplitOptions.None)
    {
        var parts = new List<string>();
        var start = 0;
        for (var i = 0; i <= source.Length; i++)
        {
            if (i == source.Length || predicate(source[i]))
            {
                if (i > start || options != StringSplitOptions.RemoveEmptyEntries)
                    parts.Add(source[start..i]);
                start = i + 1;
            }
        }
        return parts.ToArray();
    }
}
