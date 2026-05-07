using ListFlair.Api.Models;
using Microsoft.Data.Sqlite;
using Microsoft.Data.SqlClient;

namespace ListFlair.Api.Services;

public class ListFlairService : IListFlairService
{
    private readonly bool _useAzureSql;
    private readonly string? _sqlConnectionString;
    private readonly string _dbPath;
    private readonly string _dataDir;

    public ListFlairService(IConfiguration config)
    {
        _sqlConnectionString =
            config["AZURE_SQL_CONNECTION_STRING"]
            ?? Environment.GetEnvironmentVariable("AZURE_SQL_CONNECTION_STRING");
        _useAzureSql = !string.IsNullOrEmpty(_sqlConnectionString);

        // Resolve data directory relative to the repo root (4 levels up from api/bin/Debug/net10.0/)
        var repoRoot = config["RepoRoot"]
            ?? Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        _dataDir = Path.Combine(repoRoot, "data");
        _dbPath = config["SQLITE_DB_PATH"]
            ?? Path.Combine(_dataDir, "listflair.sqlite");
    }

    // ──────────────────────────────────────────────────────────────
    // Connection helpers
    // ──────────────────────────────────────────────────────────────

    private SqliteConnection OpenSqlite()
    {
        Directory.CreateDirectory(_dataDir);
        var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        return conn;
    }

    private SqlConnection OpenSqlServer()
    {
        var conn = new SqlConnection(_sqlConnectionString);
        conn.Open();
        return conn;
    }

    private static string NormalizeOwnerKey(string? ownerKey)
    {
        var normalized = ownerKey?.Trim().Length > 0 ? ownerKey.Trim() : "local-dev";
        return normalized.Length > 200 ? normalized[..200] : normalized;
    }

    // ──────────────────────────────────────────────────────────────
    // Database initialization
    // ──────────────────────────────────────────────────────────────

    public async Task InitializeDatabaseAsync()
    {
        if (_useAzureSql)
            await InitializeAzureSqlAsync();
        else
            InitializeSqlite();
    }

    private async Task InitializeAzureSqlAsync()
    {
        using var conn = OpenSqlServer();
        using var cmd = conn.CreateCommand();

        cmd.CommandText = @"
            IF OBJECT_ID(N'dbo.users', N'U') IS NULL
            BEGIN
              CREATE TABLE dbo.users (
                owner_key NVARCHAR(200) NOT NULL PRIMARY KEY,
                username NVARCHAR(100) NOT NULL UNIQUE,
                avatar_image NVARCHAR(MAX) NULL,
                created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
              );
            END;

            IF COL_LENGTH('dbo.users', 'avatar_image') IS NULL
              ALTER TABLE dbo.users ADD avatar_image NVARCHAR(MAX) NULL;

            IF OBJECT_ID(N'dbo.entries', N'U') IS NULL
            BEGIN
              CREATE TABLE dbo.entries (
                id INT IDENTITY(1,1) PRIMARY KEY,
                name NVARCHAR(200) NOT NULL,
                category NVARCHAR(80) NOT NULL,
                created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                image_url NVARCHAR(2048) NULL,
                image_status NVARCHAR(20) NOT NULL DEFAULT 'idle',
                image_source NVARCHAR(2048) NULL,
                image_error NVARCHAR(4000) NULL,
                image_query NVARCHAR(500) NULL,
                image_result_index INT NOT NULL DEFAULT 0,
                sort_order INT NOT NULL DEFAULT 0,
                owner_key NVARCHAR(200) NOT NULL DEFAULT 'local-dev'
              );
            END;

            IF COL_LENGTH('dbo.entries', 'image_url') IS NULL
              ALTER TABLE dbo.entries ADD image_url NVARCHAR(2048) NULL;
            IF COL_LENGTH('dbo.entries', 'image_status') IS NULL
              ALTER TABLE dbo.entries ADD image_status NVARCHAR(20) NOT NULL CONSTRAINT DF_entries_image_status DEFAULT 'idle';
            IF COL_LENGTH('dbo.entries', 'image_source') IS NULL
              ALTER TABLE dbo.entries ADD image_source NVARCHAR(2048) NULL;
            IF COL_LENGTH('dbo.entries', 'image_error') IS NULL
              ALTER TABLE dbo.entries ADD image_error NVARCHAR(4000) NULL;
            IF COL_LENGTH('dbo.entries', 'image_query') IS NULL
              ALTER TABLE dbo.entries ADD image_query NVARCHAR(500) NULL;
            IF COL_LENGTH('dbo.entries', 'image_result_index') IS NULL
              ALTER TABLE dbo.entries ADD image_result_index INT NOT NULL CONSTRAINT DF_entries_image_result_index DEFAULT 0;
            IF COL_LENGTH('dbo.entries', 'sort_order') IS NULL
              ALTER TABLE dbo.entries ADD sort_order INT NOT NULL CONSTRAINT DF_entries_sort_order DEFAULT 0;
            IF COL_LENGTH('dbo.entries', 'owner_key') IS NULL
              ALTER TABLE dbo.entries ADD owner_key NVARCHAR(200) NOT NULL CONSTRAINT DF_entries_owner_key DEFAULT 'local-dev';

            IF OBJECT_ID(N'dbo.entry_favorite_images', N'U') IS NULL
            BEGIN
              CREATE TABLE dbo.entry_favorite_images (
                id INT IDENTITY(1,1) PRIMARY KEY,
                owner_key NVARCHAR(200) NOT NULL,
                entry_id INT NOT NULL,
                image_url NVARCHAR(2048) NOT NULL,
                image_source NVARCHAR(2048) NULL,
                image_query NVARCHAR(500) NULL,
                created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
                CONSTRAINT UQ_entry_favorite_images UNIQUE (owner_key, entry_id, image_url)
              );
              CREATE INDEX IX_entry_favorite_images_owner_entry
                ON dbo.entry_favorite_images (owner_key, entry_id, created_at, id);
            END;";
        await cmd.ExecuteNonQueryAsync();

        // Normalize sort_order
        cmd.CommandText = @"
            SELECT id, owner_key FROM dbo.entries
            ORDER BY owner_key ASC,
              CASE WHEN sort_order IS NULL OR sort_order <= 0 THEN 1 ELSE 0 END,
              sort_order ASC, created_at ASC, id ASC";
        var rows = new List<(int Id, string OwnerKey)>();
        using (var reader = await cmd.ExecuteReaderAsync())
            while (await reader.ReadAsync())
                rows.Add((reader.GetInt32(0), NormalizeOwnerKey(reader.GetString(1))));

        using var tx = conn.BeginTransaction();
        try
        {
            var ownerSort = new Dictionary<string, int>();
            using var upd = conn.CreateCommand();
            upd.Transaction = tx;
            upd.CommandText = "UPDATE dbo.entries SET sort_order = @s WHERE id = @id";
            upd.Parameters.Add("@s", System.Data.SqlDbType.Int);
            upd.Parameters.Add("@id", System.Data.SqlDbType.Int);
            foreach (var (id, key) in rows)
            {
                ownerSort.TryGetValue(key, out var cur);
                var next = cur + 1;
                ownerSort[key] = next;
                upd.Parameters["@s"].Value = next;
                upd.Parameters["@id"].Value = id;
                await upd.ExecuteNonQueryAsync();
            }
            tx.Commit();
        }
        catch
        {
            tx.Rollback();
            throw;
        }
    }

    private void InitializeSqlite()
    {
        using var conn = OpenSqlite();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = @"
            CREATE TABLE IF NOT EXISTS users (
              owner_key TEXT NOT NULL PRIMARY KEY,
              username TEXT NOT NULL UNIQUE,
              avatar_image TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS entries (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              name TEXT NOT NULL,
              category TEXT NOT NULL,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS entry_favorite_images (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              owner_key TEXT NOT NULL,
              entry_id INTEGER NOT NULL,
              image_url TEXT NOT NULL,
              image_source TEXT,
              image_query TEXT,
              created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
              UNIQUE(owner_key, entry_id, image_url)
            );
            CREATE INDEX IF NOT EXISTS idx_entry_favorite_images_owner_entry
              ON entry_favorite_images(owner_key, entry_id, created_at, id);";
        cmd.ExecuteNonQuery();

        // Migrate entries columns
        var columns = GetSqliteTableColumns(conn, "entries");
        var migrations = new[]
        {
            ("image_url", "ALTER TABLE entries ADD COLUMN image_url TEXT"),
            ("image_status", "ALTER TABLE entries ADD COLUMN image_status TEXT NOT NULL DEFAULT 'idle'"),
            ("image_source", "ALTER TABLE entries ADD COLUMN image_source TEXT"),
            ("image_error", "ALTER TABLE entries ADD COLUMN image_error TEXT"),
            ("image_query", "ALTER TABLE entries ADD COLUMN image_query TEXT"),
            ("image_result_index", "ALTER TABLE entries ADD COLUMN image_result_index INTEGER NOT NULL DEFAULT 0"),
            ("sort_order", "ALTER TABLE entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"),
            ("owner_key", "ALTER TABLE entries ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local-dev'"),
        };
        foreach (var (col, sql) in migrations)
            if (!columns.Contains(col))
            {
                using var m = conn.CreateCommand();
                m.CommandText = sql;
                m.ExecuteNonQuery();
            }

        var userColumns = GetSqliteTableColumns(conn, "users");
        if (!userColumns.Contains("avatar_image"))
        {
            using var m = conn.CreateCommand();
            m.CommandText = "ALTER TABLE users ADD COLUMN avatar_image TEXT";
            m.ExecuteNonQuery();
        }

        // Normalize sort_order
        var rows = new List<(long Id, string OwnerKey)>();
        using (var q = conn.CreateCommand())
        {
            q.CommandText = @"SELECT id, owner_key FROM entries
                ORDER BY owner_key ASC,
                  CASE WHEN sort_order IS NULL OR sort_order <= 0 THEN 1 ELSE 0 END,
                  sort_order ASC, created_at ASC, id ASC";
            using var r = q.ExecuteReader();
            while (r.Read())
                rows.Add((r.GetInt64(0), NormalizeOwnerKey(r.IsDBNull(1) ? null : r.GetString(1))));
        }

        using var tx = conn.BeginTransaction();
        using var upd = conn.CreateCommand();
        upd.Transaction = tx;
        upd.CommandText = "UPDATE entries SET sort_order = $s WHERE id = $id";
        upd.Parameters.AddWithValue("$s", 0);
        upd.Parameters.AddWithValue("$id", 0L);
        var ownerSort = new Dictionary<string, int>();
        foreach (var (id, key) in rows)
        {
            ownerSort.TryGetValue(key, out var cur);
            var next = cur + 1;
            ownerSort[key] = next;
            upd.Parameters["$s"].Value = next;
            upd.Parameters["$id"].Value = id;
            upd.ExecuteNonQuery();
        }
        tx.Commit();
    }

    private static HashSet<string> GetSqliteTableColumns(SqliteConnection conn, string tableName)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"PRAGMA table_info({tableName})";
        using var r = cmd.ExecuteReader();
        while (r.Read())
            set.Add(r.GetString(1));
        return set;
    }

    // ──────────────────────────────────────────────────────────────
    // GetListflair
    // ──────────────────────────────────────────────────────────────

    public async Task<object> GetListflairAsync(string ownerKey, int size = 100)
    {
        var key = NormalizeOwnerKey(ownerKey);
        var capped = Math.Clamp(size, 1, 100);

        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var countCmd = conn.CreateCommand();
            countCmd.CommandText = "SELECT COUNT(1) FROM dbo.entries WHERE owner_key = @k";
            countCmd.Parameters.AddWithValue("@k", key);
            var total = (int)(await countCmd.ExecuteScalarAsync() ?? 0);

            var items = new List<EntryListItem>();
            using var listCmd = conn.CreateCommand();
            listCmd.CommandText = @"
                SELECT TOP (@lim) id, name, category, image_url, image_status
                FROM dbo.entries WHERE owner_key = @k
                ORDER BY sort_order ASC, id ASC";
            listCmd.Parameters.AddWithValue("@lim", capped);
            listCmd.Parameters.AddWithValue("@k", key);
            using var r = await listCmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                items.Add(new EntryListItem
                {
                    Id = r.GetInt32(0),
                    Name = r.GetString(1),
                    Category = r.GetString(2),
                    ImageUrl = r.IsDBNull(3) ? null : r.GetString(3),
                    ImageStatus = r.IsDBNull(4) ? "idle" : r.GetString(4)
                });

            return new { generatedAt = DateTime.UtcNow, count = items.Count, totalEntries = total, items };
        }
        else
        {
            using var conn = OpenSqlite();
            int total;
            using (var c = conn.CreateCommand())
            {
                c.CommandText = "SELECT COUNT(1) FROM entries WHERE owner_key = $k";
                c.Parameters.AddWithValue("$k", key);
                total = Convert.ToInt32(c.ExecuteScalar());
            }

            var items = new List<EntryListItem>();
            using var listCmd = conn.CreateCommand();
            listCmd.CommandText = @"
                SELECT id, name, category, image_url, image_status
                FROM entries WHERE owner_key = $k
                ORDER BY sort_order ASC, id ASC LIMIT $lim";
            listCmd.Parameters.AddWithValue("$k", key);
            listCmd.Parameters.AddWithValue("$lim", capped);
            using var r = listCmd.ExecuteReader();
            while (r.Read())
                items.Add(new EntryListItem
                {
                    Id = (int)r.GetInt64(0),
                    Name = r.GetString(1),
                    Category = r.GetString(2),
                    ImageUrl = r.IsDBNull(3) ? null : r.GetString(3),
                    ImageStatus = r.IsDBNull(4) ? "idle" : r.GetString(4)
                });

            return new { generatedAt = DateTime.UtcNow, count = items.Count, totalEntries = total, items };
        }
    }

    // ──────────────────────────────────────────────────────────────
    // GetEntry
    // ──────────────────────────────────────────────────────────────

    public async Task<Entry?> GetEntryAsync(string ownerKey, int id)
    {
        var key = NormalizeOwnerKey(ownerKey);
        const string select = @"
            SELECT id, name, category, image_url, image_status, image_source,
                   image_error, image_query, image_result_index
            FROM {0} WHERE id = {1} AND owner_key = {2}";

        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = string.Format(select, "dbo.entries", "@id", "@k");
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@k", key);
            using var r = await cmd.ExecuteReaderAsync();
            if (!await r.ReadAsync()) return null;
            return ReadEntry(r);
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = string.Format(select, "entries", "$id", "$k");
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$k", key);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return null;
            return ReadEntrySqlite(r);
        }
    }

    private static Entry ReadEntry(SqlDataReader r) => new()
    {
        Id = r.GetInt32(0),
        Name = r.GetString(1),
        Category = r.GetString(2),
        ImageUrl = r.IsDBNull(3) ? null : r.GetString(3),
        ImageStatus = r.IsDBNull(4) ? "idle" : r.GetString(4),
        ImageSource = r.IsDBNull(5) ? null : r.GetString(5),
        ImageError = r.IsDBNull(6) ? null : r.GetString(6),
        ImageQuery = r.IsDBNull(7) ? null : r.GetString(7),
        ImageResultIndex = r.IsDBNull(8) ? 0 : r.GetInt32(8)
    };

    private static Entry ReadEntrySqlite(SqliteDataReader r) => new()
    {
        Id = (int)r.GetInt64(0),
        Name = r.GetString(1),
        Category = r.GetString(2),
        ImageUrl = r.IsDBNull(3) ? null : r.GetString(3),
        ImageStatus = r.IsDBNull(4) ? "idle" : r.GetString(4),
        ImageSource = r.IsDBNull(5) ? null : r.GetString(5),
        ImageError = r.IsDBNull(6) ? null : r.GetString(6),
        ImageQuery = r.IsDBNull(7) ? null : r.GetString(7),
        ImageResultIndex = r.IsDBNull(8) ? 0 : (int)r.GetInt64(8)
    };

    // ──────────────────────────────────────────────────────────────
    // AddEntry
    // ──────────────────────────────────────────────────────────────

    public async Task<EntryListItem> AddEntryAsync(string ownerKey, string name, string category)
    {
        var key = NormalizeOwnerKey(ownerKey);

        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();

            using var sortCmd = conn.CreateCommand();
            sortCmd.CommandText = "SELECT ISNULL(MAX(sort_order), 0) + 1 FROM dbo.entries WHERE owner_key = @k";
            sortCmd.Parameters.AddWithValue("@k", key);
            var nextSort = Convert.ToInt32(await sortCmd.ExecuteScalarAsync());

            using var ins = conn.CreateCommand();
            ins.CommandText = @"
                INSERT INTO dbo.entries (name, category, sort_order, owner_key)
                OUTPUT INSERTED.id, INSERTED.name, INSERTED.category,
                       INSERTED.image_url, INSERTED.image_status
                VALUES (@name, @cat, @sort, @k)";
            ins.Parameters.AddWithValue("@name", name);
            ins.Parameters.AddWithValue("@cat", category);
            ins.Parameters.AddWithValue("@sort", nextSort);
            ins.Parameters.AddWithValue("@k", key);
            using var r = await ins.ExecuteReaderAsync();
            await r.ReadAsync();
            return new EntryListItem
            {
                Id = r.GetInt32(0), Name = r.GetString(1), Category = r.GetString(2),
                ImageUrl = r.IsDBNull(3) ? null : r.GetString(3),
                ImageStatus = r.IsDBNull(4) ? "idle" : r.GetString(4)
            };
        }
        else
        {
            using var conn = OpenSqlite();
            int nextSort;
            using (var q = conn.CreateCommand())
            {
                q.CommandText = "SELECT COALESCE(MAX(sort_order), 0) + 1 FROM entries WHERE owner_key = $k";
                q.Parameters.AddWithValue("$k", key);
                nextSort = Convert.ToInt32(q.ExecuteScalar());
            }

            long newId;
            using (var ins = conn.CreateCommand())
            {
                ins.CommandText = "INSERT INTO entries (name, category, sort_order, owner_key) VALUES ($n,$c,$s,$k)";
                ins.Parameters.AddWithValue("$n", name);
                ins.Parameters.AddWithValue("$c", category);
                ins.Parameters.AddWithValue("$s", nextSort);
                ins.Parameters.AddWithValue("$k", key);
                ins.ExecuteNonQuery();
                ins.CommandText = "SELECT last_insert_rowid()";
                ins.Parameters.Clear();
                newId = (long)(ins.ExecuteScalar() ?? 0L);
            }

            return new EntryListItem { Id = (int)newId, Name = name, Category = category, ImageUrl = null, ImageStatus = "idle" };
        }
    }

    // ──────────────────────────────────────────────────────────────
    // UpdateEntry
    // ──────────────────────────────────────────────────────────────

    public async Task<Entry?> UpdateEntryAsync(string ownerKey, int id, string name, string category)
    {
        var key = NormalizeOwnerKey(ownerKey);
        const string sql = @"UPDATE {0} SET name={1}, category={2},
            image_url=NULL, image_status='idle', image_source=NULL,
            image_error=NULL, image_query=NULL, image_result_index=0
            WHERE id={3} AND owner_key={4}";

        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = string.Format(sql, "dbo.entries", "@name", "@cat", "@id", "@k");
            cmd.Parameters.AddWithValue("@name", name);
            cmd.Parameters.AddWithValue("@cat", category);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@k", key);
            var affected = await cmd.ExecuteNonQueryAsync();
            return affected > 0 ? new Entry { Id = id, Name = name, Category = category, ImageStatus = "idle" } : null;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = string.Format(sql, "entries", "$name", "$cat", "$id", "$k");
            cmd.Parameters.AddWithValue("$name", name);
            cmd.Parameters.AddWithValue("$cat", category);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$k", key);
            var affected = cmd.ExecuteNonQuery();
            return affected > 0 ? new Entry { Id = id, Name = name, Category = category, ImageStatus = "idle" } : null;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // DeleteEntry
    // ──────────────────────────────────────────────────────────────

    public async Task<bool> DeleteEntryAsync(string ownerKey, int id)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM dbo.entries WHERE id = @id AND owner_key = @k";
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@k", key);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM entries WHERE id = $id AND owner_key = $k";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$k", key);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // ReorderEntries
    // ──────────────────────────────────────────────────────────────

    public async Task<bool> ReorderEntriesAsync(string ownerKey, List<int> orderedIds)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (orderedIds.Count == 0 || orderedIds.Count != orderedIds.Distinct().Count())
            return false;

        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();

            using var countCmd = conn.CreateCommand();
            countCmd.CommandText = "SELECT COUNT(1) FROM dbo.entries WHERE owner_key = @k";
            countCmd.Parameters.AddWithValue("@k", key);
            var total = Convert.ToInt32(await countCmd.ExecuteScalarAsync());
            if (total != orderedIds.Count) return false;

            using var tx = conn.BeginTransaction();
            try
            {
                using var upd = conn.CreateCommand();
                upd.Transaction = tx;
                upd.CommandText = "UPDATE dbo.entries SET sort_order = @s WHERE id = @id AND owner_key = @k";
                upd.Parameters.Add("@s", System.Data.SqlDbType.Int);
                upd.Parameters.Add("@id", System.Data.SqlDbType.Int);
                upd.Parameters.AddWithValue("@k", key);
                var updatedCount = 0;
                for (var i = 0; i < orderedIds.Count; i++)
                {
                    upd.Parameters["@s"].Value = i + 1;
                    upd.Parameters["@id"].Value = orderedIds[i];
                    updatedCount += await upd.ExecuteNonQueryAsync();
                }
                if (updatedCount != orderedIds.Count) { tx.Rollback(); return false; }
                tx.Commit();
                return true;
            }
            catch { tx.Rollback(); throw; }
        }
        else
        {
            using var conn = OpenSqlite();
            int total;
            using (var c = conn.CreateCommand())
            {
                c.CommandText = "SELECT COUNT(1) FROM entries WHERE owner_key = $k";
                c.Parameters.AddWithValue("$k", key);
                total = Convert.ToInt32(c.ExecuteScalar());
            }
            if (total != orderedIds.Count) return false;

            using var tx = conn.BeginTransaction();
            using var upd = conn.CreateCommand();
            upd.Transaction = tx;
            upd.CommandText = "UPDATE entries SET sort_order = $s WHERE id = $id AND owner_key = $k";
            upd.Parameters.AddWithValue("$s", 0);
            upd.Parameters.AddWithValue("$id", 0);
            upd.Parameters.AddWithValue("$k", key);
            var updatedCount = 0;
            for (var i = 0; i < orderedIds.Count; i++)
            {
                upd.Parameters["$s"].Value = i + 1;
                upd.Parameters["$id"].Value = orderedIds[i];
                updatedCount += upd.ExecuteNonQuery();
            }
            if (updatedCount != orderedIds.Count) { tx.Rollback(); return false; }
            tx.Commit();
            return true;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Image status updates
    // ──────────────────────────────────────────────────────────────

    public async Task<bool> MarkEntryImageLoadingAsync(string ownerKey, int id, int imageResultIndex = 0)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"UPDATE dbo.entries SET image_status='loading', image_error=NULL,
                image_result_index=@idx WHERE id=@id AND owner_key=@k";
            cmd.Parameters.AddWithValue("@idx", imageResultIndex);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@k", key);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"UPDATE entries SET image_status='loading', image_error=NULL,
                image_result_index=$idx WHERE id=$id AND owner_key=$k";
            cmd.Parameters.AddWithValue("$idx", imageResultIndex);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$k", key);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public async Task<bool> SetEntryImageReadyAsync(string ownerKey, int id, string imageUrl,
        string? imageSource, string? imageQuery, int imageResultIndex = 0)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"UPDATE dbo.entries SET image_url=@url, image_status='ready',
                image_source=@src, image_error=NULL, image_query=@qry, image_result_index=@idx
                WHERE id=@id AND owner_key=@k";
            cmd.Parameters.AddWithValue("@url", imageUrl);
            cmd.Parameters.AddWithValue("@src", (object?)imageSource ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qry", (object?)imageQuery ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@idx", imageResultIndex);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@k", key);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"UPDATE entries SET image_url=$url, image_status='ready',
                image_source=$src, image_error=NULL, image_query=$qry, image_result_index=$idx
                WHERE id=$id AND owner_key=$k";
            cmd.Parameters.AddWithValue("$url", imageUrl);
            cmd.Parameters.AddWithValue("$src", (object?)imageSource ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$qry", (object?)imageQuery ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$idx", imageResultIndex);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$k", key);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public async Task<bool> SetEntryImageErrorAsync(string ownerKey, int id, string imageError)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"UPDATE dbo.entries SET image_status='error', image_error=@err
                WHERE id=@id AND owner_key=@k";
            cmd.Parameters.AddWithValue("@err", imageError.Length > 4000 ? imageError[..4000] : imageError);
            cmd.Parameters.AddWithValue("@id", id);
            cmd.Parameters.AddWithValue("@k", key);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "UPDATE entries SET image_status='error', image_error=$err WHERE id=$id AND owner_key=$k";
            cmd.Parameters.AddWithValue("$err", imageError);
            cmd.Parameters.AddWithValue("$id", id);
            cmd.Parameters.AddWithValue("$k", key);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    // ──────────────────────────────────────────────────────────────
    // User profile
    // ──────────────────────────────────────────────────────────────

    public async Task<UserProfile> GetUserProfileAsync(string ownerKey)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT username, avatar_image FROM dbo.users WHERE owner_key = @k";
            cmd.Parameters.AddWithValue("@k", key);
            using var r = await cmd.ExecuteReaderAsync();
            if (!await r.ReadAsync()) return new UserProfile();
            return new UserProfile
            {
                Username = r.IsDBNull(0) ? null : r.GetString(0),
                AvatarImage = r.IsDBNull(1) ? null : r.GetString(1)
            };
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT username, avatar_image FROM users WHERE owner_key = $k";
            cmd.Parameters.AddWithValue("$k", key);
            using var r = cmd.ExecuteReader();
            if (!r.Read()) return new UserProfile();
            return new UserProfile
            {
                Username = r.IsDBNull(0) ? null : r.GetString(0),
                AvatarImage = r.IsDBNull(1) ? null : r.GetString(1)
            };
        }
    }

    public async Task<SetUserProfileResult> SetUserProfileAsync(
        string ownerKey, string? username, string? avatarImage, bool avatarProvided)
    {
        var key = NormalizeOwnerKey(ownerKey);
        var trimmedUsername = username?.Trim();
        var hasUsername = !string.IsNullOrEmpty(trimmedUsername);
        if (trimmedUsername?.Length > 100) trimmedUsername = trimmedUsername[..100];
        var normalizedAvatar = avatarProvided ? avatarImage : null;

        if (!hasUsername && !avatarProvided)
            return new SetUserProfileResult { Success = false, Reason = "no_changes" };

        if (_useAzureSql)
        {
            try
            {
                using var conn = OpenSqlServer();
                using var cmd = conn.CreateCommand();

                if (hasUsername)
                {
                    cmd.CommandText = @"
                        MERGE INTO dbo.users AS target
                        USING (SELECT @k AS owner_key, @u AS username, @av AS avatar_image, @avp AS avatar_provided) AS source
                        ON target.owner_key = source.owner_key
                        WHEN MATCHED THEN UPDATE SET
                            username = source.username,
                            avatar_image = CASE WHEN source.avatar_provided = 1 THEN source.avatar_image ELSE target.avatar_image END,
                            updated_at = SYSUTCDATETIME()
                        WHEN NOT MATCHED THEN INSERT (owner_key, username, avatar_image)
                            VALUES (source.owner_key, source.username,
                                CASE WHEN source.avatar_provided = 1 THEN source.avatar_image ELSE NULL END);";
                    cmd.Parameters.AddWithValue("@k", key);
                    cmd.Parameters.AddWithValue("@u", trimmedUsername!);
                    cmd.Parameters.AddWithValue("@av", (object?)normalizedAvatar ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@avp", avatarProvided ? 1 : 0);
                    await cmd.ExecuteNonQueryAsync();
                    return new SetUserProfileResult { Success = true };
                }
                else
                {
                    cmd.CommandText = @"UPDATE dbo.users SET avatar_image=@av, updated_at=SYSUTCDATETIME()
                        WHERE owner_key=@k";
                    cmd.Parameters.AddWithValue("@av", (object?)normalizedAvatar ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("@k", key);
                    var affected = await cmd.ExecuteNonQueryAsync();
                    return affected == 0
                        ? new SetUserProfileResult { Success = false, Reason = "username_required" }
                        : new SetUserProfileResult { Success = true };
                }
            }
            catch (SqlException ex) when (ex.Message.Contains("UNIQUE") || ex.Number == 2627 || ex.Number == 2601)
            {
                return new SetUserProfileResult { Success = false, Reason = "username_taken" };
            }
        }
        else
        {
            try
            {
                using var conn = OpenSqlite();
                using var cmd = conn.CreateCommand();

                if (hasUsername)
                {
                    cmd.CommandText = @"
                        INSERT INTO users (owner_key, username, avatar_image)
                        VALUES ($k, $u, $av)
                        ON CONFLICT(owner_key) DO UPDATE SET
                            username = excluded.username,
                            avatar_image = CASE WHEN $avp = 1 THEN excluded.avatar_image ELSE users.avatar_image END,
                            updated_at = CURRENT_TIMESTAMP";
                    cmd.Parameters.AddWithValue("$k", key);
                    cmd.Parameters.AddWithValue("$u", trimmedUsername!);
                    cmd.Parameters.AddWithValue("$av", (object?)normalizedAvatar ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("$avp", avatarProvided ? 1 : 0);
                    cmd.ExecuteNonQuery();
                    return new SetUserProfileResult { Success = true };
                }
                else
                {
                    cmd.CommandText = "UPDATE users SET avatar_image=$av, updated_at=CURRENT_TIMESTAMP WHERE owner_key=$k";
                    cmd.Parameters.AddWithValue("$av", (object?)normalizedAvatar ?? DBNull.Value);
                    cmd.Parameters.AddWithValue("$k", key);
                    var affected = cmd.ExecuteNonQuery();
                    return affected == 0
                        ? new SetUserProfileResult { Success = false, Reason = "username_required" }
                        : new SetUserProfileResult { Success = true };
                }
            }
            catch (SqliteException ex) when (ex.Message.Contains("UNIQUE"))
            {
                return new SetUserProfileResult { Success = false, Reason = "username_taken" };
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Favorite images
    // ──────────────────────────────────────────────────────────────

    public async Task<List<FavoriteImage>> ListFavoriteImagesAsync(string ownerKey, int entryId)
    {
        var key = NormalizeOwnerKey(ownerKey);
        const string sql = @"SELECT image_url, image_source, image_query
            FROM {0} WHERE owner_key={1} AND entry_id={2}
            ORDER BY created_at ASC, id ASC";

        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = string.Format(sql, "dbo.entry_favorite_images", "@k", "@eid");
            cmd.Parameters.AddWithValue("@k", key);
            cmd.Parameters.AddWithValue("@eid", entryId);
            var list = new List<FavoriteImage>();
            using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
                list.Add(new FavoriteImage
                {
                    ImageUrl = r.GetString(0),
                    ImageSource = r.IsDBNull(1) ? null : r.GetString(1),
                    ImageQuery = r.IsDBNull(2) ? null : r.GetString(2)
                });
            return list;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = string.Format(sql, "entry_favorite_images", "$k", "$eid");
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$eid", entryId);
            var list = new List<FavoriteImage>();
            using var r = cmd.ExecuteReader();
            while (r.Read())
                list.Add(new FavoriteImage
                {
                    ImageUrl = r.GetString(0),
                    ImageSource = r.IsDBNull(1) ? null : r.GetString(1),
                    ImageQuery = r.IsDBNull(2) ? null : r.GetString(2)
                });
            return list;
        }
    }

    public async Task<bool> IsFavoriteImageAsync(string ownerKey, int entryId, string imageUrl)
    {
        if (string.IsNullOrEmpty(imageUrl)) return false;
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"SELECT TOP(1) 1 FROM dbo.entry_favorite_images
                WHERE owner_key=@k AND entry_id=@eid AND image_url=@url";
            cmd.Parameters.AddWithValue("@k", key);
            cmd.Parameters.AddWithValue("@eid", entryId);
            cmd.Parameters.AddWithValue("@url", imageUrl);
            return await cmd.ExecuteScalarAsync() != null;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT 1 FROM entry_favorite_images WHERE owner_key=$k AND entry_id=$eid AND image_url=$url LIMIT 1";
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$eid", entryId);
            cmd.Parameters.AddWithValue("$url", imageUrl);
            return cmd.ExecuteScalar() != null;
        }
    }

    public async Task AddFavoriteImageAsync(string ownerKey, int entryId, string imageUrl,
        string? imageSource, string? imageQuery)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"
                IF NOT EXISTS (SELECT 1 FROM dbo.entry_favorite_images WHERE owner_key=@k AND entry_id=@eid AND image_url=@url)
                INSERT INTO dbo.entry_favorite_images (owner_key, entry_id, image_url, image_source, image_query)
                VALUES (@k, @eid, @url, @src, @qry)";
            cmd.Parameters.AddWithValue("@k", key);
            cmd.Parameters.AddWithValue("@eid", entryId);
            cmd.Parameters.AddWithValue("@url", imageUrl);
            cmd.Parameters.AddWithValue("@src", (object?)imageSource ?? DBNull.Value);
            cmd.Parameters.AddWithValue("@qry", (object?)imageQuery ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync();
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = @"INSERT OR IGNORE INTO entry_favorite_images
                (owner_key, entry_id, image_url, image_source, image_query)
                VALUES ($k, $eid, $url, $src, $qry)";
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$eid", entryId);
            cmd.Parameters.AddWithValue("$url", imageUrl);
            cmd.Parameters.AddWithValue("$src", (object?)imageSource ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$qry", (object?)imageQuery ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
    }

    public async Task<bool> RemoveFavoriteImageAsync(string ownerKey, int entryId, string imageUrl)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM dbo.entry_favorite_images WHERE owner_key=@k AND entry_id=@eid AND image_url=@url";
            cmd.Parameters.AddWithValue("@k", key);
            cmd.Parameters.AddWithValue("@eid", entryId);
            cmd.Parameters.AddWithValue("@url", imageUrl);
            return await cmd.ExecuteNonQueryAsync() > 0;
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM entry_favorite_images WHERE owner_key=$k AND entry_id=$eid AND image_url=$url";
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$eid", entryId);
            cmd.Parameters.AddWithValue("$url", imageUrl);
            return cmd.ExecuteNonQuery() > 0;
        }
    }

    public async Task RemoveAllFavoriteImagesForEntryAsync(string ownerKey, int entryId)
    {
        var key = NormalizeOwnerKey(ownerKey);
        if (_useAzureSql)
        {
            using var conn = OpenSqlServer();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM dbo.entry_favorite_images WHERE owner_key=@k AND entry_id=@eid";
            cmd.Parameters.AddWithValue("@k", key);
            cmd.Parameters.AddWithValue("@eid", entryId);
            await cmd.ExecuteNonQueryAsync();
        }
        else
        {
            using var conn = OpenSqlite();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM entry_favorite_images WHERE owner_key=$k AND entry_id=$eid";
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$eid", entryId);
            cmd.ExecuteNonQuery();
        }
    }
}
