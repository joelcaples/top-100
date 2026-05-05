const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const sql = require("mssql");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "listflair.sqlite");
const USE_AZURE_SQL = Boolean(process.env.AZURE_SQL_CONNECTION_STRING);

let sqliteDb;
let sqlPoolPromise;

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
        sort_order INT NOT NULL DEFAULT 0
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
  `);

  const orderedRows = await pool.request().query(`
    SELECT id
    FROM dbo.entries
    ORDER BY
      CASE WHEN sort_order IS NULL OR sort_order <= 0 THEN 1 ELSE 0 END,
      sort_order ASC,
      created_at ASC,
      id ASC
  `);

  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (let index = 0; index < orderedRows.recordset.length; index += 1) {
      const id = orderedRows.recordset[index].id;
      await new sql.Request(transaction)
        .input("id", sql.Int, id)
        .input("sortOrder", sql.Int, index + 1)
        .query("UPDATE dbo.entries SET sort_order = @sortOrder WHERE id = @id");
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
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

  const rows = database
    .prepare(
      `
      SELECT id
      FROM entries
      ORDER BY
        CASE WHEN sort_order IS NULL OR sort_order <= 0 THEN 1 ELSE 0 END,
        sort_order ASC,
        created_at ASC,
        id ASC
    `
    )
    .all();

  const reorder = database.prepare("UPDATE entries SET sort_order = ? WHERE id = ?");
  const normalise = database.transaction(() => {
    rows.forEach((row, index) => {
      reorder.run(index + 1, row.id);
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

async function getListflair(size = 100) {
  const normalized = Number.isNaN(Number(size)) ? 100 : Number(size);
  const cappedSize = Math.max(1, Math.min(normalized, 100));

  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const totalResult = await pool.request().query("SELECT COUNT(1) AS count FROM dbo.entries");
    const totalEntries = Number(totalResult.recordset[0]?.count || 0);

    const selectionResult = await pool
      .request()
      .input("limit", sql.Int, cappedSize)
      .query(`
        SELECT TOP (@limit)
          id,
          name,
          category,
          image_url AS imageUrl,
          image_status AS imageStatus
        FROM dbo.entries
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
  const totalEntries = database.prepare("SELECT COUNT(1) AS count FROM entries").get().count;
  const selection = database
    .prepare(
      "SELECT id, name, category, image_url AS imageUrl, image_status AS imageStatus FROM entries ORDER BY sort_order ASC, id ASC LIMIT ?"
    )
    .all(cappedSize);

  return {
    generatedAt: new Date().toISOString(),
    count: selection.length,
    totalEntries,
    items: selection
  };
}

async function deleteEntry(id) {
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool.request().input("id", sql.Int, id).query("DELETE FROM dbo.entries WHERE id = @id");
    return result.rowsAffected[0] > 0;
  }

  const database = getSqliteDatabase();
  const result = database.prepare("DELETE FROM entries WHERE id = ?").run(id);
  return result.changes > 0;
}

async function addEntry(name, category) {
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const sortResult = await pool
      .request()
      .query("SELECT ISNULL(MAX(sort_order), 0) + 1 AS nextSortOrder FROM dbo.entries");
    const nextSortOrder = Number(sortResult.recordset[0]?.nextSortOrder || 1);

    const result = await pool
      .request()
      .input("name", sql.NVarChar(200), name)
      .input("category", sql.NVarChar(80), category)
      .input("sortOrder", sql.Int, nextSortOrder)
      .query(`
        INSERT INTO dbo.entries (name, category, sort_order)
        OUTPUT INSERTED.id, INSERTED.name, INSERTED.category, INSERTED.image_url AS imageUrl,
               INSERTED.image_status AS imageStatus, INSERTED.image_source AS imageSource
        VALUES (@name, @category, @sortOrder)
      `);

    return result.recordset[0];
  }

  const database = getSqliteDatabase();
  const nextSortOrder = Number(
    database.prepare("SELECT COALESCE(MAX(sort_order), 0) + 1 AS nextSortOrder FROM entries").get().nextSortOrder
  );
  const result = database
    .prepare("INSERT INTO entries (name, category, sort_order) VALUES (?, ?, ?)")
    .run(name, category, nextSortOrder);
  return {
    id: result.lastInsertRowid,
    name,
    category,
    imageUrl: null,
    imageStatus: "idle",
    imageSource: null
  };
}

async function updateEntry(id, name, category) {
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("name", sql.NVarChar(200), name)
      .input("category", sql.NVarChar(80), category)
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
        WHERE id = @id
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
      WHERE id = ?
    `)
    .run(name, category, id);

  return result.changes > 0 ? { id, name, category } : null;
}

async function getEntry(id) {
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool.request().input("id", sql.Int, id).query(`
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
      WHERE id = @id
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
      WHERE id = ?
    `)
      .get(id) || null
  );
}

async function markEntryImageLoading(id, imageResultIndex = 0) {
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("imageResultIndex", sql.Int, imageResultIndex)
      .query(`
        UPDATE dbo.entries
        SET image_status = 'loading',
            image_error = NULL,
            image_result_index = @imageResultIndex
        WHERE id = @id
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
      WHERE id = ?
    `)
    .run(imageResultIndex, id);

  return result.changes > 0;
}

async function setEntryImageReady(id, imageUrl, imageSource = null, imageQuery = null, imageResultIndex = 0) {
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("imageUrl", sql.NVarChar(2048), imageUrl)
      .input("imageSource", sql.NVarChar(2048), imageSource)
      .input("imageQuery", sql.NVarChar(500), imageQuery)
      .input("imageResultIndex", sql.Int, imageResultIndex)
      .query(`
        UPDATE dbo.entries
        SET image_url = @imageUrl,
            image_status = 'ready',
            image_source = @imageSource,
            image_error = NULL,
            image_query = @imageQuery,
            image_result_index = @imageResultIndex
        WHERE id = @id
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
      WHERE id = ?
    `)
    .run(imageUrl, imageSource, imageQuery, imageResultIndex, id);

  return result.changes > 0;
}

async function setEntryImageError(id, imageError) {
  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const result = await pool
      .request()
      .input("id", sql.Int, id)
      .input("imageError", sql.NVarChar(4000), imageError)
      .query(`
        UPDATE dbo.entries
        SET image_status = 'error',
            image_error = @imageError
        WHERE id = @id
      `);

    return result.rowsAffected[0] > 0;
  }

  const database = getSqliteDatabase();
  const result = database
    .prepare(`
      UPDATE entries
      SET image_status = 'error',
          image_error = ?
      WHERE id = ?
    `)
    .run(imageError, id);

  return result.changes > 0;
}

async function reorderEntries(orderedIds = []) {
  const ids = normaliseIdList(orderedIds);
  if (!ids.length || !hasUniqueIds(ids)) {
    return false;
  }

  if (USE_AZURE_SQL) {
    const pool = await getAzureSqlPool();
    const totalResult = await pool.request().query("SELECT COUNT(1) AS count FROM dbo.entries");
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
          .input("sortOrder", sql.Int, index + 1)
          .query("UPDATE dbo.entries SET sort_order = @sortOrder WHERE id = @id");
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
  const totalEntries = Number(database.prepare("SELECT COUNT(1) AS count FROM entries").get().count || 0);
  if (totalEntries !== ids.length) {
    return false;
  }

  const reorder = database.prepare("UPDATE entries SET sort_order = ? WHERE id = ?");
  const applyReorder = database.transaction(() => {
    let updatedCount = 0;
    ids.forEach((id, index) => {
      const result = reorder.run(index + 1, id);
      updatedCount += Number(result.changes || 0);
    });
    return updatedCount === ids.length;
  });

  return applyReorder();
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
  reorderEntries
};
