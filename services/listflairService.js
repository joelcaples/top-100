const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "listflair.sqlite");
const USE_AZURE_SQL = Boolean(process.env.AZURE_SQL_CONNECTION_STRING);

let sqliteDb;
let sqlPoolPromise;

function normalizeOwnerKey(ownerKey) {
  const normalized = typeof ownerKey === "string" ? ownerKey.trim().slice(0, 200) : "";
  return normalized || "local-dev";
}

function normaliseIdList(ids = []) {
  return ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
}

function hasUniqueIds(ids = []) {
  return new Set(ids).size === ids.length;
}

function getSqliteDatabase() {
  if (sqliteDb) {
    return sqliteDb;
  }

  const Database = require("better-sqlite3");
  fs.mkdirSync(DATA_DIR, { recursive: true });
  sqliteDb = new Database(DB_PATH);
  return sqliteDb;
}

async function getAzureSqlPool() {
  if (!sqlPoolPromise) {
    sqlPoolPromise = sql.connect(process.env.AZURE_SQL_CONNECTION_STRING);
  }

  return sqlPoolPromise;
}

async function initializeAzureSqlDatabase() {
  const pool = await getAzureSqlPool();
  await pool.request().query(`
    IF OBJECT_ID(N'dbo.users', N'U') IS NULL
    BEGIN
      CREATE TABLE dbo.users (
        owner_key NVARCHAR(200) NOT NULL PRIMARY KEY,
        username NVARCHAR(100) NOT NULL UNIQUE,
        created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
      );
    END;

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
      CREATE INDEX IX_entry_favorite_images_owner_entry ON dbo.entry_favorite_images (owner_key, entry_id, created_at, id);
    END;
  `);

  const orderedRows = await pool.request().query(`
    SELECT id, owner_key
    FROM dbo.entries
    ORDER BY
      owner_key ASC,
      CASE WHEN sort_order IS NULL OR sort_order <= 0 THEN 1 ELSE 0 END,
      sort_order ASC,
      created_at ASC,
      id ASC
  `);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const ownerSortOrder = new Map();

    for (let index = 0; index < orderedRows.recordset.length; index += 1) {
      const id = orderedRows.recordset[index].id;
      const ownerKey = normalizeOwnerKey(orderedRows.recordset[index].owner_key);
      const nextSortOrder = (ownerSortOrder.get(ownerKey) || 0) + 1;

      await new sql.Request(transaction)
        .input("id", sql.Int, id)
        .input("sortOrder", sql.Int, nextSortOrder)
        .query("UPDATE dbo.entries SET sort_order = @sortOrder WHERE id = @id");

      ownerSortOrder.set(ownerKey, nextSortOrder);
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

function initializeSqliteDatabase() {
  const database = getSqliteDatabase();

  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      owner_key TEXT NOT NULL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
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
    )
  `);

  const columns = new Set(
    database.prepare("PRAGMA table_info(entries)").all().map((column) => column.name)
  );

  if (!columns.has("image_url")) {
    database.exec("ALTER TABLE entries ADD COLUMN image_url TEXT");
  }

  if (!columns.has("image_status")) {
    database.exec("ALTER TABLE entries ADD COLUMN image_status TEXT NOT NULL DEFAULT 'idle'");
  }

  if (!columns.has("image_source")) {
    database.exec("ALTER TABLE entries ADD COLUMN image_source TEXT");
  }

  if (!columns.has("image_error")) {
    database.exec("ALTER TABLE entries ADD COLUMN image_error TEXT");
  }

  if (!columns.has("image_query")) {
    database.exec("ALTER TABLE entries ADD COLUMN image_query TEXT");
  }

  if (!columns.has("image_result_index")) {
    database.exec("ALTER TABLE entries ADD COLUMN image_result_index INTEGER NOT NULL DEFAULT 0");
  }

  if (!columns.has("sort_order")) {
    database.exec("ALTER TABLE entries ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
  }

  if (!columns.has("owner_key")) {
    database.exec("ALTER TABLE entries ADD COLUMN owner_key TEXT NOT NULL DEFAULT 'local-dev'");
  }

  database.exec(
    "CREATE INDEX IF NOT EXISTS idx_entry_favorite_images_owner_entry ON entry_favorite_images(owner_key, entry_id, created_at, id)"
  );

  const rows = database
    .prepare(
      `
      SELECT id, owner_key
      FROM entries
      ORDER BY
        owner_key ASC,
        CASE WHEN sort_order IS NULL OR sort_order <= 0 THEN 1 ELSE 0 END,
        sort_order ASC,
        created_at ASC,
        id ASC
    `
    )
    .all();

  const reorder = database.prepare("UPDATE entries SET sort_order = ? WHERE id = ?");
  const normalise = database.transaction(() => {
    const ownerSortOrder = new Map();

    rows.forEach((row, index) => {
      const ownerKey = normalizeOwnerKey(row.owner_key);
      const nextSortOrder = (ownerSortOrder.get(ownerKey) || 0) + 1;

      reorder.run(nextSortOrder, row.id);
      ownerSortOrder.set(ownerKey, nextSortOrder);
    });
  });
  normalise();
}

async function initializeDatabase() {
  if (USE_AZURE_SQL) {
    await initializeAzureSqlDatabase();
    return;
  }

  initializeSqliteDatabase();
}

async function getListflair(ownerKey, size = 100) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  const normalized = Number.isNaN(Number(size)) ? 100 : Number(size);
  const cappedSize = Math.max(1, Math.min(normalized, 100));

  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const totalResult = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query("SELECT COUNT(1) AS count FROM dbo.entries WHERE owner_key = @ownerKey");
    const totalEntries = Number(totalResult.recordset[0]?.count || 0);

    const selectionResult = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .input("limit", sql.Int, cappedSize)
      .query(`
        SELECT TOP (@limit)
          id,
          name,
          category,
          image_url AS imageUrl,
          image_status AS imageStatus
        FROM dbo.entries
        WHERE owner_key = @ownerKey
        ORDER BY sort_order ASC, id ASC
      `);

    return {
      generatedAt: new Date().toISOString(),
      count: selectionResult.recordset.length,
      totalEntries,
      items: selectionResult.recordset
    };
  }

  const database = getSqliteDatabase();
  const totalEntries = database
    .prepare("SELECT COUNT(1) AS count FROM entries WHERE owner_key = ?")
    .get(scopedOwnerKey).count;
  const selection = database
    .prepare(
      "SELECT id, name, category, image_url AS imageUrl, image_status AS imageStatus FROM entries WHERE owner_key = ? ORDER BY sort_order ASC, id ASC LIMIT ?"
    )
    .all(scopedOwnerKey, cappedSize);

  return {
    generatedAt: new Date().toISOString(),
    count: selection.length,
    totalEntries,
    items: selection
  };
}

async function deleteEntry(ownerKey, id) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query("DELETE FROM dbo.entries WHERE id = @id AND owner_key = @ownerKey");
    return result.rowsAffected[0] > 0;
  }

  const database = getSqliteDatabase();
  const result = database.prepare("DELETE FROM entries WHERE id = ? AND owner_key = ?").run(id, scopedOwnerKey);
  return result.changes > 0;
}

async function addEntry(ownerKey, name, category) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const sortResult = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query("SELECT ISNULL(MAX(sort_order), 0) + 1 AS nextSortOrder FROM dbo.entries WHERE owner_key = @ownerKey");
    const nextSortOrder = Number(sortResult.recordset[0]?.nextSortOrder || 1);

    const result = await pool
      .request()
      .input("name", sql.NVarChar(200), name)
      .input("category", sql.NVarChar(80), category)
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .input("sortOrder", sql.Int, nextSortOrder)
      .query(`
        INSERT INTO dbo.entries (name, category, sort_order, owner_key)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.category, INSERTED.image_url AS imageUrl,
               INSERTED.image_status AS imageStatus, INSERTED.image_source AS imageSource
        VALUES (@name, @category, @sortOrder, @ownerKey)
      `);

    return result.recordset[0];
  }

  const database = getSqliteDatabase();
  const nextSortOrder = Number(
    database
      .prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextSortOrder FROM entries WHERE owner_key = ?")
      .get(scopedOwnerKey).nextSortOrder
  );
  const result = database
    .prepare("INSERT INTO entries (name, category, sort_order, owner_key) VALUES (?, ?, ?, ?)")
    .run(name, category, nextSortOrder, scopedOwnerKey);
  return {
    id: result.lastInsertRowid,
    name,
    category,
    imageUrl: null,
    imageStatus: "idle",
    imageSource: null
  };
}

async function updateEntry(ownerKey, id, name, category) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar(200), name)
      .input("category", sql.NVarChar(80), category)
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query(`
        UPDATE dbo.entries
        SET name = @name,
            category = @category,
            image_url = NULL,
            image_status = 'idle',
            image_source = NULL,
            image_error = NULL,
            image_query = NULL,
            image_result_index = 0
        WHERE id = @id AND owner_key = @ownerKey
      `);

    return result.rowsAffected[0] > 0 ? { id, name, category } : null;
  }

  const database = getSqliteDatabase();
  const result = database
    .prepare(`
      UPDATE entries
      SET name = ?,
          category = ?,
          image_url = NULL,
          image_status = 'idle',
          image_source = NULL,
          image_error = NULL,
          image_query = NULL,
          image_result_index = 0
      WHERE id = ? AND owner_key = ?
    `)
    .run(name, category, id, scopedOwnerKey);

  return result.changes > 0 ? { id, name, category } : null;
}

async function getEntry(ownerKey, id) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool.request().input("id", sql.Int, id).input("ownerKey", sql.NVarChar(200), scopedOwnerKey).query(`
      SELECT
        id,
        name,
        category,
        image_url AS imageUrl,
        image_status AS imageStatus,
        image_source AS imageSource,
        image_error AS imageError,
        image_query AS imageQuery,
        image_result_index AS imageResultIndex
      FROM dbo.entries
      WHERE id = @id AND owner_key = @ownerKey
    `);

    return result.recordset[0] || null;
  }

  const database = getSqliteDatabase();
  return (
    database
      .prepare(`
      SELECT
        id,
        name,
        category,
        image_url AS imageUrl,
        image_status AS imageStatus,
        image_source AS imageSource,
        image_error AS imageError,
        image_query AS imageQuery,
        image_result_index AS imageResultIndex
      FROM entries
      WHERE id = ? AND owner_key = ?
    `)
      .get(id, scopedOwnerKey) || null
  );
}

async function markEntryImageLoading(ownerKey, id, imageResultIndex = 0) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("imageResultIndex", sql.Int, imageResultIndex)
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query(`
        UPDATE dbo.entries
        SET image_status = 'loading',
            image_error = NULL,
            image_result_index = @imageResultIndex
        WHERE id = @id AND owner_key = @ownerKey
      `);

    return result.rowsAffected[0] > 0;
  }

  const database = getSqliteDatabase();
  const result = database
    .prepare(`
      UPDATE entries
      SET image_status = 'loading',
          image_error = NULL,
          image_result_index = ?
      WHERE id = ? AND owner_key = ?
    `)
    .run(imageResultIndex, id, scopedOwnerKey);

  return result.changes > 0;
}

async function setEntryImageReady(ownerKey, id, imageUrl, imageSource = null, imageQuery = null, imageResultIndex = 0) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("imageUrl", sql.NVarChar(2048), imageUrl)
      .input("imageSource", sql.NVarChar(2048), imageSource)
      .input("imageQuery", sql.NVarChar(500), imageQuery)
      .input("imageResultIndex", sql.Int, imageResultIndex)
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query(`
        UPDATE dbo.entries
        SET image_url = @imageUrl,
            image_status = 'ready',
            image_source = @imageSource,
            image_error = NULL,
            image_query = @imageQuery,
            image_result_index = @imageResultIndex
        WHERE id = @id AND owner_key = @ownerKey
      `);

    return result.rowsAffected[0] > 0;
  }

  const database = getSqliteDatabase();
  const result = database
    .prepare(`
      UPDATE entries
      SET image_url = ?,
          image_status = 'ready',
          image_source = ?,
          image_error = NULL,
          image_query = ?,
          image_result_index = ?
      WHERE id = ? AND owner_key = ?
    `)
    .run(imageUrl, imageSource, imageQuery, imageResultIndex, id, scopedOwnerKey);

  return result.changes > 0;
}

async function setEntryImageError(ownerKey, id, imageError) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("imageError", sql.NVarChar(4000), imageError)
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query(`
        UPDATE dbo.entries
        SET image_status = 'error',
            image_error = @imageError
        WHERE id = @id AND owner_key = @ownerKey
      `);

    return result.rowsAffected[0] > 0;
  }

  const database = getSqliteDatabase();
  const result = database
    .prepare(`
      UPDATE entries
      SET image_status = 'error',
          image_error = ?
      WHERE id = ? AND owner_key = ?
    `)
    .run(imageError, id, scopedOwnerKey);

  return result.changes > 0;
}

async function reorderEntries(ownerKey, orderedIds = []) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  const ids = normaliseIdList(orderedIds);
  if (!ids.length || !hasUniqueIds(ids)) {
    return false;
  }

  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const totalResult = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query("SELECT COUNT(1) AS count FROM dbo.entries WHERE owner_key = @ownerKey");
    const totalEntries = Number(totalResult.recordset[0]?.count || 0);
    if (totalEntries !== ids.length) {
      return false;
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();
    try {
      let updatedCount = 0;
      for (let index = 0; index < ids.length; index += 1) {
        const id = ids[index];
        const result = await new sql.Request(transaction)
          .input("id", sql.Int, id)
          .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
          .input("sortOrder", sql.Int, index + 1)
          .query("UPDATE dbo.entries SET sort_order = @sortOrder WHERE id = @id AND owner_key = @ownerKey");
        updatedCount += Number(result.rowsAffected[0] || 0);
      }

      if (updatedCount !== ids.length) {
        await transaction.rollback();
        return false;
      }

      await transaction.commit();
      return true;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  const database = getSqliteDatabase();
  const totalEntries = Number(
    database.prepare("SELECT COUNT(1) AS count FROM entries WHERE owner_key = ?").get(scopedOwnerKey).count || 0
  );
  if (totalEntries !== ids.length) {
    return false;
  }

  const reorder = database.prepare("UPDATE entries SET sort_order = ? WHERE id = ? AND owner_key = ?");
  const applyReorder = database.transaction(() => {
    let updatedCount = 0;
    ids.forEach((id, index) => {
      const result = reorder.run(index + 1, id, scopedOwnerKey);
      updatedCount += Number(result.changes || 0);
    });
    return updatedCount === ids.length;
  });

  return applyReorder();
}

async function getUsername(ownerKey) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .query("SELECT username FROM dbo.users WHERE owner_key = @ownerKey");
    return result.recordset[0]?.username || null;
  }

  const database = getSqliteDatabase();
  return database.prepare("SELECT username FROM users WHERE owner_key = ?").get(scopedOwnerKey)?.username || null;
}

async function setUsername(ownerKey, username) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  const trimmedUsername = (typeof username === "string" ? username.trim() : "").slice(0, 100);

  if (!trimmedUsername) {
    return false;
  }

  if (USE_AZURE_SQL) {
    try {
      const pool = await getAzureSqlPool();
      const result = await pool
        .request()
        .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
        .input("username", sql.NVarChar(100), trimmedUsername)
        .query(`
          MERGE INTO dbo.users AS target
          USING (SELECT @ownerKey AS owner_key, @username AS username) AS source
          ON target.owner_key = source.owner_key
          WHEN MATCHED THEN UPDATE SET username = source.username, updated_at = SYSUTCDATETIME()
          WHEN NOT MATCHED THEN INSERT (owner_key, username) VALUES (source.owner_key, source.username);
        `);
      return true;
    } catch (error) {
      if (error.message && error.message.includes("UNIQUE")) {
        return false;
      }
      throw error;
    }
  }

  const database = getSqliteDatabase();
  try {
    const stmt = database.prepare(`
      INSERT INTO users (owner_key, username) VALUES (?, ?)
      ON CONFLICT(owner_key) DO UPDATE SET username = excluded.username, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(scopedOwnerKey, trimmedUsername);
    return true;
  } catch (error) {
    if (error.message && error.message.includes("UNIQUE")) {
      return false;
    }
    throw error;
  }
}

async function listFavoriteImages(ownerKey, entryId) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .input("entryId", sql.Int, entryId)
      .query(`
        SELECT
          image_url AS imageUrl,
          image_source AS imageSource,
          image_query AS imageQuery,
          created_at AS createdAt
        FROM dbo.entry_favorite_images
        WHERE owner_key = @ownerKey AND entry_id = @entryId
        ORDER BY created_at ASC, id ASC
      `);
    return result.recordset;
  }

  const database = getSqliteDatabase();
  return database
    .prepare(
      `
      SELECT
        image_url AS imageUrl,
        image_source AS imageSource,
        image_query AS imageQuery,
        created_at AS createdAt
      FROM entry_favorite_images
      WHERE owner_key = ? AND entry_id = ?
      ORDER BY created_at ASC, id ASC
    `
    )
    .all(scopedOwnerKey, entryId);
}

async function isFavoriteImage(ownerKey, entryId, imageUrl) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (!imageUrl) {
    return false;
  }

  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .input("entryId", sql.Int, entryId)
      .input("imageUrl", sql.NVarChar(2048), imageUrl)
      .query(`
        SELECT TOP (1) 1 AS found
        FROM dbo.entry_favorite_images
        WHERE owner_key = @ownerKey AND entry_id = @entryId AND image_url = @imageUrl
      `);
    return Boolean(result.recordset[0]?.found);
  }

  const database = getSqliteDatabase();
  const row = database
    .prepare(
      "SELECT 1 AS found FROM entry_favorite_images WHERE owner_key = ? AND entry_id = ? AND image_url = ? LIMIT 1"
    )
    .get(scopedOwnerKey, entryId, imageUrl);
  return Boolean(row?.found);
}

async function addFavoriteImage(ownerKey, entryId, imageUrl, imageSource = null, imageQuery = null) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (!imageUrl) {
    return false;
  }

  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .input("entryId", sql.Int, entryId)
      .input("imageUrl", sql.NVarChar(2048), imageUrl)
      .input("imageSource", sql.NVarChar(2048), imageSource)
      .input("imageQuery", sql.NVarChar(500), imageQuery)
      .query(`
        MERGE dbo.entry_favorite_images AS target
        USING (
          SELECT
            @ownerKey AS owner_key,
            @entryId AS entry_id,
            @imageUrl AS image_url,
            @imageSource AS image_source,
            @imageQuery AS image_query
        ) AS source
        ON target.owner_key = source.owner_key
          AND target.entry_id = source.entry_id
          AND target.image_url = source.image_url
        WHEN MATCHED THEN
          UPDATE SET image_source = source.image_source, image_query = source.image_query
        WHEN NOT MATCHED THEN
          INSERT (owner_key, entry_id, image_url, image_source, image_query)
          VALUES (source.owner_key, source.entry_id, source.image_url, source.image_source, source.image_query);
      `);
    return true;
  }

  const database = getSqliteDatabase();
  database
    .prepare(
      `
      INSERT INTO entry_favorite_images (owner_key, entry_id, image_url, image_source, image_query)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(owner_key, entry_id, image_url)
      DO UPDATE SET
        image_source = excluded.image_source,
        image_query = excluded.image_query
    `
    )
    .run(scopedOwnerKey, entryId, imageUrl, imageSource, imageQuery);

  return true;
}

async function removeFavoriteImage(ownerKey, entryId, imageUrl) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (!imageUrl) {
    return false;
  }

  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .input("entryId", sql.Int, entryId)
      .input("imageUrl", sql.NVarChar(2048), imageUrl)
      .query(`
        DELETE FROM dbo.entry_favorite_images
        WHERE owner_key = @ownerKey AND entry_id = @entryId AND image_url = @imageUrl
      `);
    return result.rowsAffected[0] > 0;
  }

  const database = getSqliteDatabase();
  const result = database
    .prepare("DELETE FROM entry_favorite_images WHERE owner_key = ? AND entry_id = ? AND image_url = ?")
    .run(scopedOwnerKey, entryId, imageUrl);
  return result.changes > 0;
}

async function removeAllFavoriteImagesForEntry(ownerKey, entryId) {
  const scopedOwnerKey = normalizeOwnerKey(ownerKey);
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    await pool
      .request()
      .input("ownerKey", sql.NVarChar(200), scopedOwnerKey)
      .input("entryId", sql.Int, entryId)
      .query("DELETE FROM dbo.entry_favorite_images WHERE owner_key = @ownerKey AND entry_id = @entryId");
    return;
  }

  const database = getSqliteDatabase();
  database.prepare("DELETE FROM entry_favorite_images WHERE owner_key = ? AND entry_id = ?").run(scopedOwnerKey, entryId);
}

module.exports = {
  initializeDatabase,
  getListflair,
  deleteEntry,
  addEntry,
  updateEntry,
  getEntry,
  markEntryImageLoading,
  setEntryImageReady,
  setEntryImageError,
  reorderEntries,
  getUsername,
  setUsername,
  listFavoriteImages,
  isFavoriteImage,
  addFavoriteImage,
  removeFavoriteImage,
  removeAllFavoriteImagesForEntry
};
