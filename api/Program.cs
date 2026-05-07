using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.FileProviders;
using ListFlair.Api.Models;
using ListFlair.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ──────────────────────────────────────────────────────────────────
// Services
// ──────────────────────────────────────────────────────────────────

builder.Services.ConfigureHttpJsonOptions(opts =>
{
    opts.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    opts.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

// Named HTTP clients
builder.Services.AddHttpClient("openverse", c =>
{
    c.DefaultRequestHeaders.Add("User-Agent", "listflair-app/1.0");
    c.DefaultRequestHeaders.Add("Accept", "application/json");
    c.Timeout = TimeSpan.FromSeconds(15);
});

builder.Services.AddHttpClient("imagedownload", c =>
{
    c.DefaultRequestHeaders.Add("User-Agent", "listflair-app/1.0");
    c.DefaultRequestHeaders.Add("Accept", "image/*");
    c.Timeout = TimeSpan.FromSeconds(20);
});

builder.Services.AddHttpClient("duckduckgo", c =>
{
    c.DefaultRequestHeaders.Add("User-Agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
    c.DefaultRequestHeaders.Add("Accept-Language", "en-US,en;q=0.9");
    c.Timeout = TimeSpan.FromSeconds(15);
});

builder.Services.AddHttpClient("github", c =>
{
    c.DefaultRequestHeaders.Add("User-Agent", "listflair-app/1.0");
    c.DefaultRequestHeaders.Add("Accept", "application/json");
    c.Timeout = TimeSpan.FromSeconds(10);
});

builder.Services.AddSingleton<IListFlairService, ListFlairService>();
builder.Services.AddSingleton<IImageLookupService, ImageLookupService>();
builder.Services.AddSingleton(new ConcurrentDictionary<string, LocalPrincipal>());  // local sessions
builder.Services.AddSingleton(new ConcurrentDictionary<string, Task>());             // pending image lookups

var app = builder.Build();

// ──────────────────────────────────────────────────────────────────
// Database initialization
// ──────────────────────────────────────────────────────────────────

var listFlairService = app.Services.GetRequiredService<IListFlairService>();
await listFlairService.InitializeDatabaseAsync();

// ──────────────────────────────────────────────────────────────────
// Static file serving
// ──────────────────────────────────────────────────────────────────

var webRootPath = app.Configuration["WebRootPath"]
    ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));

var generatedImageDir = app.Services.GetRequiredService<IImageLookupService>().GeneratedImageDir;
Directory.CreateDirectory(generatedImageDir);

if (Directory.Exists(webRootPath))
{
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(webRootPath),
        RequestPath = "",
        ServeUnknownFileTypes = false
    });
}

app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(generatedImageDir),
    RequestPath = "/generated-images"
});

// ──────────────────────────────────────────────────────────────────
// User context middleware
// ──────────────────────────────────────────────────────────────────

var localSessions = app.Services.GetRequiredService<ConcurrentDictionary<string, LocalPrincipal>>();

app.Use(async (ctx, next) =>
{
    ctx.Items["UserContext"] = BuildUserContext(ctx.Request, localSessions, app.Configuration);
    await next(ctx);
});

// ──────────────────────────────────────────────────────────────────
// HTML index (with __SITE_ORIGIN__ injection)
// ──────────────────────────────────────────────────────────────────

var indexHtmlPath = Path.Combine(webRootPath, "index.html");

app.MapGet("/", async (HttpContext ctx) => await ServeIndexHtml(ctx, indexHtmlPath, app.Configuration));
app.MapGet("/index.html", async (HttpContext ctx) => await ServeIndexHtml(ctx, indexHtmlPath, app.Configuration));

// ──────────────────────────────────────────────────────────────────
// Local OAuth routes
// ──────────────────────────────────────────────────────────────────

var githubClientId = app.Configuration["GITHUB_CLIENT_ID"] ?? Environment.GetEnvironmentVariable("GITHUB_CLIENT_ID");
var githubClientSecret = app.Configuration["GITHUB_CLIENT_SECRET"] ?? Environment.GetEnvironmentVariable("GITHUB_CLIENT_SECRET");

app.MapGet("/auth/login/github", (HttpContext ctx) =>
{
    var origin = GetSiteOrigin(ctx.Request, app.Configuration);
    if (!IsLocalOrigin(origin)) return Results.NotFound();
    if (string.IsNullOrEmpty(githubClientId) || string.IsNullOrEmpty(githubClientSecret))
        return Results.Problem("Local GitHub OAuth is not configured", statusCode: 500);

    var redirectUri = Uri.EscapeDataString($"{origin}/auth/callback/github");
    var scope = Uri.EscapeDataString("user:email");
    var githubAuthUrl = $"https://github.com/login/oauth/authorize?client_id={githubClientId}&redirect_uri={redirectUri}&scope={scope}";
    return Results.Redirect(githubAuthUrl);
});

app.MapGet("/auth/callback/github", async (HttpContext ctx) =>
{
    var origin = GetSiteOrigin(ctx.Request, app.Configuration);
    if (!IsLocalOrigin(origin)) return Results.NotFound();

    if (string.IsNullOrEmpty(githubClientId) || string.IsNullOrEmpty(githubClientSecret))
        return Results.Redirect("/?error=oauth_not_configured");

    var code = ctx.Request.Query["code"].ToString();
    var redirectUri = ctx.Request.Query["redirect_uri"].ToString();
    if (string.IsNullOrEmpty(redirectUri)) redirectUri = "/";

    if (string.IsNullOrEmpty(code)) return Results.Redirect($"{redirectUri}?error=no_code");

    try
    {
        var httpFactory = ctx.RequestServices.GetRequiredService<IHttpClientFactory>();
        var accessToken = await ExchangeGitHubCodeAsync(httpFactory, code, githubClientId, githubClientSecret, origin);
        var githubUser = await GetGitHubUserAsync(httpFactory, accessToken);

        var principal = new LocalPrincipal
        {
            AuthTyp = "github",
            UserId = $"github:{githubUser.Id}",
            UserDetails = githubUser.Login ?? ""
        };

        var sessionId = $"session_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}_{Guid.NewGuid():N}";
        localSessions[sessionId] = principal;
        SetSessionCookie(ctx.Response, sessionId);
        return Results.Redirect(redirectUri);
    }
    catch
    {
        return Results.Redirect($"{redirectUri}?error=auth_failed");
    }
});

app.MapGet("/auth/logout", (HttpContext ctx) =>
{
    var origin = GetSiteOrigin(ctx.Request, app.Configuration);
    if (IsLocalOrigin(origin))
    {
        var sessionId = GetSessionCookie(ctx.Request);
        if (!string.IsNullOrEmpty(sessionId))
        {
            localSessions.TryRemove(sessionId, out _);
            ctx.Response.Headers.Append("Set-Cookie", "listflair_session=; Path=/; HttpOnly; Max-Age=0");
        }
    }

    var redirectUri = ctx.Request.Query["redirect_uri"].ToString();
    return Results.Redirect(string.IsNullOrEmpty(redirectUri) ? "/" : redirectUri);
});

// ──────────────────────────────────────────────────────────────────
// API auth guard middleware
// ──────────────────────────────────────────────────────────────────

var publicApiPaths = new HashSet<string>(["/api/health", "/api/me", "/api/dev/login"], StringComparer.OrdinalIgnoreCase);

app.Use(async (ctx, next) =>
{
    if (!ctx.Request.Path.StartsWithSegments("/api") || publicApiPaths.Contains(ctx.Request.Path))
    {
        await next(ctx);
        return;
    }

    var userCtx = (UserContext?)ctx.Items["UserContext"];
    if (userCtx is not { IsAuthenticated: true })
    {
        var authUrls = GetAuthUrls(ctx.Request, app.Configuration);
        ctx.Response.StatusCode = 401;
        ctx.Response.ContentType = "application/json";
        await ctx.Response.WriteAsync(JsonSerializer.Serialize(new
        {
            error = "Sign in required",
            loginUrl = authUrls.LoginUrl,
            provider = authUrls.Provider
        }));
        return;
    }

    await next(ctx);
});

// ──────────────────────────────────────────────────────────────────
// API routes
// ──────────────────────────────────────────────────────────────────

var imageLookupService = app.Services.GetRequiredService<IImageLookupService>();
var pendingLookups = app.Services.GetRequiredService<ConcurrentDictionary<string, Task>>();

app.MapGet("/api/health", () => Results.Ok(new { ok = true }));

app.MapGet("/api/me", async (HttpContext ctx) =>
{
    var userCtx = (UserContext)ctx.Items["UserContext"]!;
    var authUrls = GetAuthUrls(ctx.Request, app.Configuration);
    var origin = GetSiteOrigin(ctx.Request, app.Configuration);

    UserProfile profile;
    if (userCtx.IsAuthenticated)
        profile = await listFlairService.GetUserProfileAsync(userCtx.Key);
    else
        profile = new UserProfile();

    return Results.Ok(new
    {
        isAuthenticated = userCtx.IsAuthenticated,
        displayName = userCtx.DisplayName,
        username = profile.Username,
        avatarImage = profile.AvatarImage,
        loginUrl = authUrls.LoginUrl,
        logoutUrl = authUrls.LogoutUrl,
        authProvider = authUrls.Provider,
        _debug = new { origin, isLocal = IsLocalOrigin(origin), userContextKey = userCtx.Key }
    });
});

app.MapGet("/api/listflair", async (HttpContext ctx, int? size) =>
{
    var key = GetOwnerKey(ctx);
    var result = await listFlairService.GetListflairAsync(key, size ?? 100);
    return Results.Ok(result);
});

app.MapPost("/api/user", async (HttpContext ctx) =>
{
    var key = GetOwnerKey(ctx);

    // Use raw JSON to detect key presence (mirrors JS hasOwnProperty check)
    ctx.Request.EnableBuffering();
    using var doc = await JsonDocument.ParseAsync(ctx.Request.Body);
    var root = doc.RootElement;

    var username = root.TryGetProperty("username", out var uEl) ? uEl.GetString() : null;
    var avatarProvided = root.TryGetProperty("avatarImage", out var avEl);
    var avatarImage = avatarProvided ? avEl.GetString() : null;

    var hasUsername = !string.IsNullOrWhiteSpace(username);

    if (!hasUsername && !avatarProvided)
        return Results.BadRequest(new { error = "At least one of username or avatarImage must be provided" });

    if (avatarProvided && avatarImage is { Length: > 0 } av)
    {
        if (!av.TrimStart().StartsWith("data:image/") || av.Length > 300_000)
            return Results.BadRequest(new { error = "avatarImage must be a valid data:image URL under 300KB" });
    }

    var result = await listFlairService.SetUserProfileAsync(key, username, avatarImage, avatarProvided);

    if (!result.Success && result.Reason == "username_taken")
        return Results.Conflict(new { error = "Username is already taken" });

    if (!result.Success && result.Reason == "username_required")
        return Results.BadRequest(new { error = "Set a username before setting an avatar" });

    var updated = await listFlairService.GetUserProfileAsync(key);
    return Results.Ok(new { username = updated.Username, avatarImage = updated.AvatarImage });
});

app.MapGet("/api/user", async (HttpContext ctx) =>
{
    var key = GetOwnerKey(ctx);
    var profile = await listFlairService.GetUserProfileAsync(key);
    return Results.Ok(new { username = profile.Username, avatarImage = profile.AvatarImage });
});

app.MapPost("/api/entries", async (HttpContext ctx) =>
{
    var key = GetOwnerKey(ctx);
    var body = await ReadJsonAsync<EntryCreateRequest>(ctx);
    if (string.IsNullOrWhiteSpace(body?.Name) || string.IsNullOrWhiteSpace(body?.Category))
        return Results.BadRequest(new { error = "name and category are required strings" });

    var entry = await listFlairService.AddEntryAsync(
        key, body.Name.Trim()[..Math.Min(body.Name.Length, 200)],
        body.Category.Trim()[..Math.Min(body.Category.Length, 80)]);
    return Results.Created($"/api/entries/{entry.Id}", entry);
});

app.MapMethods("/api/entries/reorder", ["PATCH"], async (HttpContext ctx) =>
{
    var key = GetOwnerKey(ctx);
    var body = await ReadJsonAsync<ReorderRequest>(ctx);
    if (body?.OrderedIds is not { Count: > 0 })
        return Results.BadRequest(new { error = "orderedIds must be a non-empty array" });

    var ok = await listFlairService.ReorderEntriesAsync(key, body.OrderedIds);
    return ok ? Results.Ok(new { ok = true }) : Results.BadRequest(new { error = "Invalid reorder payload" });
});

app.MapDelete("/api/entries/{id:int}", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);

    var existing = await listFlairService.GetEntryAsync(key, id);
    var deleted = await listFlairService.DeleteEntryAsync(key, id);
    if (!deleted) return Results.NotFound(new { error = "Entry not found" });

    var favorites = await listFlairService.ListFavoriteImagesAsync(key, id);
    await listFlairService.RemoveAllFavoriteImagesForEntryAsync(key, id);

    if (existing?.ImageUrl != null)
        await imageLookupService.RemoveCachedImageAsync(existing.ImageUrl);

    foreach (var fav in favorites)
        if (fav.ImageUrl != existing?.ImageUrl)
            await imageLookupService.RemoveCachedImageAsync(fav.ImageUrl);

    return Results.Ok(new { ok = true, deleted = id });
});

app.MapMethods("/api/entries/{id:int}", ["PATCH"], async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);
    var body = await ReadJsonAsync<EntryCreateRequest>(ctx);
    if (string.IsNullOrWhiteSpace(body?.Name) || string.IsNullOrWhiteSpace(body?.Category))
        return Results.BadRequest(new { error = "name and category are required strings" });

    var existing = await listFlairService.GetEntryAsync(key, id);
    var updated = await listFlairService.UpdateEntryAsync(key, id,
        body.Name.Trim()[..Math.Min(body.Name.Length, 200)],
        body.Category.Trim()[..Math.Min(body.Category.Length, 80)]);
    if (updated == null) return Results.NotFound(new { error = "Entry not found" });

    if (existing?.ImageUrl != null)
        await RemoveImageIfNotFavoritedAsync(key, id, existing.ImageUrl, listFlairService, imageLookupService);

    return Results.Ok(updated);
});

app.MapGet("/api/entries/{id:int}/favorites", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);

    var entry = await listFlairService.GetEntryAsync(key, id);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });

    var favorites = await listFlairService.ListFavoriteImagesAsync(key, id);
    var images = favorites.Select(f => new FavoriteImage
    {
        ImageUrl = f.ImageUrl,
        ImageSource = f.ImageSource,
        ImageQuery = f.ImageQuery,
        IsFavorite = true,
        IsCurrent = entry.ImageUrl != null && f.ImageUrl == entry.ImageUrl
    }).ToList();

    return Results.Ok(new { entryId = id, currentImageUrl = entry.ImageUrl, images });
});

app.MapPost("/api/entries/{id:int}/favorites", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);
    var body = await ReadJsonAsync<FavoriteRequest>(ctx);

    if (string.IsNullOrEmpty(body?.ImageUrl))
        return Results.BadRequest(new { error = "imageUrl is required" });

    var entry = await listFlairService.GetEntryAsync(key, id);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });

    if (body.Favorite)
    {
        await listFlairService.AddFavoriteImageAsync(key, id, body.ImageUrl,
            body.ImageSource, body.ImageQuery is { Length: > 500 } q ? q[..500] : body.ImageQuery);
    }
    else
    {
        var removed = await listFlairService.RemoveFavoriteImageAsync(key, id, body.ImageUrl);
        if (removed && entry.ImageUrl != body.ImageUrl)
            await imageLookupService.RemoveCachedImageAsync(body.ImageUrl);
    }

    var favorites = await listFlairService.ListFavoriteImagesAsync(key, id);
    var updatedEntry = await listFlairService.GetEntryAsync(key, id);
    var images = favorites.Select(f => new FavoriteImage
    {
        ImageUrl = f.ImageUrl,
        ImageSource = f.ImageSource,
        ImageQuery = f.ImageQuery,
        IsFavorite = true,
        IsCurrent = updatedEntry?.ImageUrl != null && f.ImageUrl == updatedEntry.ImageUrl
    }).ToList();

    return Results.Ok(new { entryId = id, currentImageUrl = updatedEntry?.ImageUrl, images });
});

app.MapGet("/api/entries/{id:int}/image/search", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);
    var q = ctx.Request.Query["q"].ToString().Trim();
    if (string.IsNullOrEmpty(q)) return Results.BadRequest(new { error = "q is required" });
    if (q.Length > 200) q = q[..200];

    var entry = await listFlairService.GetEntryAsync(key, id);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });

    var results = await imageLookupService.SearchWebImagesAsync(q);
    return Results.Ok(new { results });
});

app.MapGet("/api/entries/{id:int}/image", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);
    var entry = await listFlairService.GetEntryAsync(key, id);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });
    return Results.Ok(ImagePayloadOf(entry));
});

app.MapPost("/api/entries/{id:int}/image", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);
    var entry = await listFlairService.GetEntryAsync(key, id);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });

    if (entry.ImageStatus == "ready" && entry.ImageUrl != null)
        return Results.Ok(ImagePayloadOf(entry));

    if (entry.ImageStatus != "loading")
        await listFlairService.MarkEntryImageLoadingAsync(key, id, GetRequestedImageIndex(entry));

    StartImageLookup(key, id, listFlairService, imageLookupService, pendingLookups);
    var loading = await listFlairService.GetEntryAsync(key, id);
    return Results.Accepted(value: ImagePayloadOf(loading!));
});

app.MapPost("/api/entries/{id:int}/image/refresh", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);
    var entry = await listFlairService.GetEntryAsync(key, id);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });

    if (entry.ImageStatus == "loading")
        return Results.Accepted(value: ImagePayloadOf(entry));

    await listFlairService.MarkEntryImageLoadingAsync(key, id, GetRequestedImageIndex(entry, forceRefresh: true));
    StartImageLookup(key, id, listFlairService, imageLookupService, pendingLookups);
    var loading = await listFlairService.GetEntryAsync(key, id);
    return Results.Accepted(value: ImagePayloadOf(loading!));
});

app.MapPost("/api/entries/{id:int}/image/pick", async (int id, HttpContext ctx) =>
{
    if (id < 1) return Results.BadRequest(new { error = "Invalid id" });
    var key = GetOwnerKey(ctx);
    var body = await ReadJsonAsync<PickImageRequest>(ctx);

    if (string.IsNullOrEmpty(body?.FetchUrl))
        return Results.BadRequest(new { error = "fetchUrl is required" });
    if (!body.FetchUrl.StartsWith("https://"))
        return Results.BadRequest(new { error = "fetchUrl must use https" });

    var entry = await listFlairService.GetEntryAsync(key, id);
    if (entry == null) return Results.NotFound(new { error = "Entry not found" });

    try
    {
        var cached = await imageLookupService.CacheSelectedImageAsync(
            entry, body.FetchUrl, body.ThumbnailUrl, body.SourceUrl,
            body.Query is { Length: > 500 } q ? q[..500] : body.Query);

        await SetEntryImageAndCleanupPreviousAsync(key, id, cached, listFlairService, imageLookupService);
        var updated = await listFlairService.GetEntryAsync(key, id);
        return Results.Ok(ImagePayloadOf(updated!));
    }
    catch (Exception ex)
    {
        await listFlairService.SetEntryImageErrorAsync(key, id, ex.Message);
        return Results.Problem("Could not cache the selected image", statusCode: 500);
    }
});

// ──────────────────────────────────────────────────────────────────
// Dev login (localhost only)
// ──────────────────────────────────────────────────────────────────

app.MapPost("/api/dev/login", async (HttpContext ctx) =>
{
    if (!IsLocalOrigin(GetSiteOrigin(ctx.Request, app.Configuration)))
        return Results.StatusCode(403);

    var body = await ReadJsonAsync<DevLoginRequest>(ctx);
    if (string.IsNullOrWhiteSpace(body?.Username)) return Results.BadRequest(new { error = "username is required" });
    if (string.IsNullOrWhiteSpace(body?.DisplayName)) return Results.BadRequest(new { error = "displayName is required" });

    var devKey = $"dev-local:{body.Username.Trim().ToLowerInvariant()[..Math.Min(body.Username.Length, 50)]}";
    var result = await listFlairService.SetUserProfileAsync(devKey, body.Username.Trim(), null, false);
    if (!result.Success) return Results.Conflict(new { error = "Username already taken" });

    return Results.Ok(new { message = "Dev user created", devKey, username = body.Username.Trim() });
});

app.Run();

// ──────────────────────────────────────────────────────────────────
// Helper functions
// ──────────────────────────────────────────────────────────────────

static string GetSiteOrigin(HttpRequest request, IConfiguration config)
{
    var origin = $"{request.Scheme}://{request.Host}";
    if (IsLocalOrigin(origin)) return origin;
    var publicUrl = config["PUBLIC_SITE_URL"] ?? Environment.GetEnvironmentVariable("PUBLIC_SITE_URL");
    return string.IsNullOrEmpty(publicUrl) ? origin : publicUrl.TrimEnd('/');
}

static bool IsLocalOrigin(string origin) =>
    origin.Contains("localhost") || origin.Contains("127.0.0.1") || origin.Contains("[::1]");

static (string LoginUrl, string LogoutUrl, string Provider) GetAuthUrls(HttpRequest request, IConfiguration config)
{
    var origin = GetSiteOrigin(request, config);
    var provider = config["DefaultAuthProvider"] ?? "github";
    var returnUrl = Uri.EscapeDataString($"{origin}/");

    if (IsLocalOrigin(origin))
        return ($"/auth/login/github?redirect_uri={returnUrl}", $"/auth/logout?redirect_uri={returnUrl}", provider);

    return (
        $"/.auth/login/{provider}?post_login_redirect_uri={returnUrl}",
        $"/.auth/logout?post_logout_redirect_uri={returnUrl}",
        provider);
}

static UserContext BuildUserContext(HttpRequest request, ConcurrentDictionary<string, LocalPrincipal> sessions, IConfiguration config)
{
    var origin = GetSiteOrigin(request, config);
    var localDevUserKey = config["LocalDevUserKey"] ?? "local-dev";

    if (IsLocalOrigin(origin))
    {
        var sessionId = GetSessionCookie(request);
        if (!string.IsNullOrEmpty(sessionId) && sessions.TryGetValue(sessionId, out var principal))
        {
            var ownerKey = $"{principal.AuthTyp}:{principal.UserId}";
            if (ownerKey.Length > 200) ownerKey = ownerKey[..200];
            return new UserContext { Key = ownerKey, IsAuthenticated = true, DisplayName = principal.UserDetails };
        }

        return new UserContext { Key = localDevUserKey, IsAuthenticated = false, DisplayName = "Local User" };
    }

    // Azure Easy Auth
    var principalId =
        request.Headers["x-ms-client-principal-id"].ToString()
        ?? DecodePrincipalHeader(request.Headers["x-ms-client-principal"].ToString(), "sub")
        ?? "";

    var displayName =
        request.Headers["x-ms-client-principal-name"].ToString().NullIfEmpty()
        ?? DecodePrincipalHeader(request.Headers["x-ms-client-principal"].ToString(), "name")
        ?? "";

    var idp = request.Headers["x-ms-client-principal-idp"].ToString().NullIfEmpty()
        ?? DecodePrincipalHeader(request.Headers["x-ms-client-principal"].ToString(), "auth_typ")
        ?? "local";

    if (string.IsNullOrEmpty(principalId))
        return new UserContext { Key = localDevUserKey, IsAuthenticated = false, DisplayName = "Local User" };

    var key = $"{idp}:{principalId}";
    if (key.Length > 200) key = key[..200];
    return new UserContext { Key = key, IsAuthenticated = true, DisplayName = displayName.NullIfEmpty() ?? "Signed-in User" };
}

static string? DecodePrincipalHeader(string? headerValue, string field)
{
    if (string.IsNullOrWhiteSpace(headerValue)) return null;
    try
    {
        var json = Encoding.UTF8.GetString(Convert.FromBase64String(headerValue));
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        if (root.TryGetProperty(field, out var direct)) return direct.GetString();

        if (root.TryGetProperty("claims", out var claims))
            foreach (var claim in claims.EnumerateArray())
                if (claim.TryGetProperty("typ", out var typ) && typ.GetString() == field)
                    if (claim.TryGetProperty("val", out var val)) return val.GetString();

        return null;
    }
    catch { return null; }
}

static string? GetSessionCookie(HttpRequest request)
{
    if (!request.Cookies.TryGetValue("listflair_session", out var value)) return null;
    return string.IsNullOrEmpty(value) ? null : value;
}

static void SetSessionCookie(HttpResponse response, string sessionId)
{
    response.Cookies.Append("listflair_session", sessionId, new CookieOptions
    {
        Path = "/", HttpOnly = true, SameSite = SameSiteMode.Lax, MaxAge = TimeSpan.FromDays(1)
    });
}

static string GetOwnerKey(HttpContext ctx) => ((UserContext)ctx.Items["UserContext"]!).Key;

static object ImagePayloadOf(Entry entry) => new
{
    id = entry.Id,
    status = entry.ImageStatus,
    imageUrl = entry.ImageUrl,
    imageSource = entry.ImageSource,
    error = entry.ImageError,
    imageQuery = entry.ImageQuery
};

static int GetRequestedImageIndex(Entry entry, bool forceRefresh = false)
{
    var current = entry.ImageResultIndex;
    return forceRefresh ? Math.Max(0, current + 1) : Math.Max(0, current);
}

static void StartImageLookup(string ownerKey, int entryId, IListFlairService lfs,
    IImageLookupService ils, ConcurrentDictionary<string, Task> pending)
{
    var lookupKey = $"{ownerKey}:{entryId}";
    if (pending.ContainsKey(lookupKey)) return;

    var task = Task.Run(async () =>
    {
        try
        {
            var entry = await lfs.GetEntryAsync(ownerKey, entryId);
            if (entry == null) return;

            var image = await ils.FindAndCacheImageForEntryAsync(entry, GetRequestedImageIndex(entry));
            await SetEntryImageAndCleanupPreviousAsync(ownerKey, entryId, image, lfs, ils);
        }
        catch (Exception ex)
        {
            await lfs.SetEntryImageErrorAsync(ownerKey, entryId, ex.Message);
        }
        finally
        {
            pending.TryRemove(lookupKey, out _);
        }
    });

    pending.TryAdd(lookupKey, task);
}

static async Task SetEntryImageAndCleanupPreviousAsync(string ownerKey, int entryId, CachedImage image,
    IListFlairService lfs, IImageLookupService ils)
{
    var current = await lfs.GetEntryAsync(ownerKey, entryId);
    if (current == null) return;
    var previousUrl = current.ImageUrl;

    await lfs.SetEntryImageReadyAsync(ownerKey, entryId, image.ImageUrl, image.ImageSource, image.ImageQuery, image.ImageResultIndex);

    if (!string.IsNullOrEmpty(previousUrl) && previousUrl != image.ImageUrl)
        await RemoveImageIfNotFavoritedAsync(ownerKey, entryId, previousUrl, lfs, ils);
}

static async Task RemoveImageIfNotFavoritedAsync(string ownerKey, int entryId, string? imageUrl,
    IListFlairService lfs, IImageLookupService ils)
{
    if (string.IsNullOrEmpty(imageUrl)) return;
    var isFavorite = await lfs.IsFavoriteImageAsync(ownerKey, entryId, imageUrl);
    if (!isFavorite) await ils.RemoveCachedImageAsync(imageUrl);
}

static async Task ServeIndexHtml(HttpContext ctx, string indexHtmlPath, IConfiguration config)
{
    if (!File.Exists(indexHtmlPath)) { ctx.Response.StatusCode = 404; return; }
    var html = await File.ReadAllTextAsync(indexHtmlPath);
    var origin = GetSiteOrigin(ctx.Request, config);
    html = html.Replace("__SITE_ORIGIN__", origin);
    ctx.Response.ContentType = "text/html; charset=utf-8";
    await ctx.Response.WriteAsync(html);
}

static async Task<GitHubTokenResponse> ExchangeGitHubCodeAsync(IHttpClientFactory factory,
    string code, string clientId, string secret, string origin)
{
    var client = factory.CreateClient("github");
    var body = JsonSerializer.Serialize(new { client_id = clientId, client_secret = secret, code });
    var response = await client.PostAsync("https://github.com/login/oauth/access_token",
        new StringContent(body, Encoding.UTF8, "application/json"));
    var json = await response.Content.ReadAsStringAsync();
    var data = JsonSerializer.Deserialize<GitHubTokenResponse>(json, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower })
        ?? throw new InvalidOperationException("Failed to parse GitHub token response");
    if (!string.IsNullOrEmpty(data.Error))
        throw new InvalidOperationException(data.ErrorDescription ?? data.Error);
    return data;
}

static async Task<GitHubUser> GetGitHubUserAsync(IHttpClientFactory factory, GitHubTokenResponse token)
{
    var client = factory.CreateClient("github");
    client.DefaultRequestHeaders.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("token", token.AccessToken);
    client.DefaultRequestHeaders.Add("Accept", "application/vnd.github.v3+json");
    var response = await client.GetAsync("https://api.github.com/user");
    if (!response.IsSuccessStatusCode) throw new InvalidOperationException("Failed to fetch GitHub user");
    var json = await response.Content.ReadAsStringAsync();
    return JsonSerializer.Deserialize<GitHubUser>(json, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower })
        ?? throw new InvalidOperationException("Failed to parse GitHub user");
}

// ──────────────────────────────────────────────────────────────────
// Request/response DTOs
// ──────────────────────────────────────────────────────────────────

static async Task<T?> ReadJsonAsync<T>(HttpContext ctx)
{
    try
    {
        return await ctx.Request.ReadFromJsonAsync<T>(new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
    }
    catch { return default; }
}

file sealed class EntryCreateRequest
{
    public string? Name { get; set; }
    public string? Category { get; set; }
}

file sealed class ReorderRequest
{
    public List<int>? OrderedIds { get; set; }
}

file sealed class FavoriteRequest
{
    public string? ImageUrl { get; set; }
    public bool Favorite { get; set; }
    public string? ImageSource { get; set; }
    public string? ImageQuery { get; set; }
}

file sealed class PickImageRequest
{
    public string? FetchUrl { get; set; }
    public string? ThumbnailUrl { get; set; }
    public string? SourceUrl { get; set; }
    public string? Query { get; set; }
}

file sealed class DevLoginRequest
{
    public string? Username { get; set; }
    public string? DisplayName { get; set; }
}

file sealed class GitHubTokenResponse
{
    public string? AccessToken { get; set; }
    public string? Error { get; set; }
    public string? ErrorDescription { get; set; }
}

file sealed class GitHubUser
{
    public long Id { get; set; }
    public string? Login { get; set; }
    public string? Name { get; set; }
}

static class StringExtensions2
{
    public static string? NullIfEmpty(this string? s) =>
        string.IsNullOrEmpty(s) ? null : s;
}
