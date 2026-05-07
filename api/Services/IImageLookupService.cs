using ListFlair.Api.Models;

namespace ListFlair.Api.Services;

public interface IImageLookupService
{
    string GeneratedImageDir { get; }
    Task<CachedImage> FindAndCacheImageForEntryAsync(Entry entry, int requestedIndex = 0);
    Task<List<WebImageResult>> SearchWebImagesAsync(string query);
    Task<CachedImage> CacheSelectedImageAsync(Entry entry, string fetchUrl, string? thumbnailUrl, string? sourceUrl, string? query);
    Task RemoveCachedImageAsync(string? imageUrl);
    bool IsGeneratedImageUrl(string? imageUrl);
}
