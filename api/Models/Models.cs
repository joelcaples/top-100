namespace ListFlair.Api.Models;

public class Entry
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string? ImageUrl { get; set; }
    public string ImageStatus { get; set; } = "idle";
    public string? ImageSource { get; set; }
    public string? ImageError { get; set; }
    public string? ImageQuery { get; set; }
    public int ImageResultIndex { get; set; }
    public int SortOrder { get; set; }
    public string OwnerKey { get; set; } = "";
}

public class EntryListItem
{
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public string Category { get; set; } = "";
    public string? ImageUrl { get; set; }
    public string ImageStatus { get; set; } = "idle";
}

public class UserProfile
{
    public string? Username { get; set; }
    public string? AvatarImage { get; set; }
}

public class FavoriteImage
{
    public string ImageUrl { get; set; } = "";
    public string? ImageSource { get; set; }
    public string? ImageQuery { get; set; }
    public bool IsFavorite { get; set; }
    public bool IsCurrent { get; set; }
}

public class UserContext
{
    public string Key { get; set; } = "";
    public bool IsAuthenticated { get; set; }
    public string DisplayName { get; set; } = "";
}

public class SetUserProfileResult
{
    public bool Success { get; set; }
    public string? Reason { get; set; }
}

public class LocalPrincipal
{
    public string AuthTyp { get; set; } = "";
    public string UserId { get; set; } = "";
    public string UserDetails { get; set; } = "";
}

public class CachedImage
{
    public string ImageUrl { get; set; } = "";
    public string? ImageSource { get; set; }
    public string? ImageQuery { get; set; }
    public int ImageResultIndex { get; set; }
}

public class WebImageResult
{
    public string? Title { get; set; }
    public string? ThumbnailUrl { get; set; }
    public string? FetchUrl { get; set; }
    public string? SourceUrl { get; set; }
}

public class OpenverseCandidate
{
    public string? Id { get; set; }
    public string? Title { get; set; }
    public string? Creator { get; set; }
    public string? Source { get; set; }
    public string? Url { get; set; }
    public string? Thumbnail { get; set; }
    public string? ForeignLandingUrl { get; set; }
    public int Width { get; set; }
    public int Height { get; set; }
    public List<OpenverseTag>? Tags { get; set; }
}

public class OpenverseTag
{
    public string? Name { get; set; }
}
