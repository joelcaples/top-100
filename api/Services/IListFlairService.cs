using ListFlair.Api.Models;

namespace ListFlair.Api.Services;

public interface IListFlairService
{
    Task InitializeDatabaseAsync();
    Task<object> GetListflairAsync(string ownerKey, int size = 100);
    Task<Entry?> GetEntryAsync(string ownerKey, int id);
    Task<EntryListItem> AddEntryAsync(string ownerKey, string name, string category);
    Task<Entry?> UpdateEntryAsync(string ownerKey, int id, string name, string category);
    Task<bool> DeleteEntryAsync(string ownerKey, int id);
    Task<bool> ReorderEntriesAsync(string ownerKey, List<int> orderedIds);
    Task<bool> MarkEntryImageLoadingAsync(string ownerKey, int id, int imageResultIndex = 0);
    Task<bool> SetEntryImageReadyAsync(string ownerKey, int id, string imageUrl, string? imageSource, string? imageQuery, int imageResultIndex = 0);
    Task<bool> SetEntryImageErrorAsync(string ownerKey, int id, string imageError);
    Task<UserProfile> GetUserProfileAsync(string ownerKey);
    Task<SetUserProfileResult> SetUserProfileAsync(string ownerKey, string? username, string? avatarImage, bool avatarProvided);
    Task<List<FavoriteImage>> ListFavoriteImagesAsync(string ownerKey, int entryId);
    Task<bool> IsFavoriteImageAsync(string ownerKey, int entryId, string imageUrl);
    Task AddFavoriteImageAsync(string ownerKey, int entryId, string imageUrl, string? imageSource, string? imageQuery);
    Task<bool> RemoveFavoriteImageAsync(string ownerKey, int entryId, string imageUrl);
    Task RemoveAllFavoriteImagesForEntryAsync(string ownerKey, int entryId);
}
