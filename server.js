const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const {
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
} = require("./services/listflairService");
const {
  findAndCacheImageForEntry,
  searchWebImages,
  cacheSelectedImage,
  removeCachedImage,
  GENERATED_IMAGE_DIR
} = require("./services/imageLookupService");

const app = express();
const PORT = process.env.PORT || 3000;
const INDEX_HTML_PATH = path.join(__dirname, "index.html");
const pendingImageLookups = new Map();
const USE_AZURE_SQL = Boolean(process.env.AZURE_SQL_CONNECTION_STRING);
const USE_BLOB_STORAGE = Boolean(process.env.AZURE_STORAGE_CONNECTION_STRING);
const STORAGE_CONTAINER = process.env.AZURE_STORAGE_CONTAINER || "generated-images";
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL;
const LOCAL_DEV_USER_KEY = process.env.LOCAL_DEV_USER_KEY || "local-dev";
const DEFAULT_AUTH_PROVIDER = process.env.DEFAULT_AUTH_PROVIDER || "github";

// GitHub OAuth Configuration
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;

// Local session store (in-memory, for dev only)
const localSessions = new Map();



app.set("trust proxy", true);
app.use(express.json());

function sendImagePayload(res, entry, statusCode = 200) {
  res.status(statusCode).json({
    id: entry.id,
    status: entry.imageStatus,
    imageUrl: entry.imageUrl,
    imageSource: entry.imageSource,
    error: entry.imageError,
    imageQuery: entry.imageQuery
  });
}

function getRequestedImageIndex(entry, forceRefresh = false) {
  const currentIndex = Number.isInteger(entry.imageResultIndex)
    ? entry.imageResultIndex
    : Number(entry.imageResultIndex || 0);

  return forceRefresh ? Math.max(0, currentIndex + 1) : Math.max(0, currentIndex);
}

async function removeImageIfNotFavorited(ownerKey, entryId, imageUrl) {
  if (!imageUrl) {
    return;
  }

  const keepImage = await isFavoriteImage(ownerKey, entryId, imageUrl);
  if (!keepImage) {
    await removeCachedImage(imageUrl);
  }
}

async function setEntryImageAndCleanupPrevious(ownerKey, entryId, nextImage) {
  const currentEntry = await getEntry(ownerKey, entryId);
  if (!currentEntry) {
    return null;
  }

  const previousImageUrl = currentEntry.imageUrl;
  await setEntryImageReady(
    ownerKey,
    entryId,
    nextImage.imageUrl,
    nextImage.imageSource,
    nextImage.imageQuery,
    nextImage.imageResultIndex
  );

  if (previousImageUrl && previousImageUrl !== nextImage.imageUrl) {
    await removeImageIfNotFavorited(ownerKey, entryId, previousImageUrl);
  }

  return getEntry(ownerKey, entryId);
}

async function getEntryViewerImages(ownerKey, entryId) {
  const entry = await getEntry(ownerKey, entryId);
  if (!entry) {
    return null;
  }

  const favorites = await listFavoriteImages(ownerKey, entryId);
  const favoritesWithFlags = favorites.map((image) => ({
    ...image,
    isFavorite: true,
    isCurrent: Boolean(entry.imageUrl && image.imageUrl === entry.imageUrl)
  }));

  return {
    entry,
    images: favoritesWithFlags
  };
}

function startImageLookup(ownerKey, entryId) {
  const lookupKey = `${ownerKey}:${entryId}`;
  if (pendingImageLookups.has(lookupKey)) {
    return pendingImageLookups.get(lookupKey);
  }

  const lookupPromise = (async () => {
    try {
      const entry = await getEntry(ownerKey, entryId);
      if (!entry) {
        return;
      }

      const image = await findAndCacheImageForEntry(entry, getRequestedImageIndex(entry));
      await setEntryImageAndCleanupPrevious(ownerKey, entryId, image);
    } catch (error) {
      await setEntryImageError(ownerKey, entryId, error.message);
    } finally {
      pendingImageLookups.delete(lookupKey);
    }
  })();

  pendingImageLookups.set(lookupKey, lookupPromise);
  return lookupPromise;
}

function getSiteOrigin(req) {

  const protocol = req.protocol;
  const host = req.get("host");
  const currentOrigin = `${protocol}://${host}`;
  const isLocal = currentOrigin.includes("localhost") || currentOrigin.includes("127.0.0.1") || currentOrigin.includes("[::1]");
  

  
  // Always use the current request origin for local, even if PUBLIC_SITE_URL is set
  if (isLocal) {

    return currentOrigin;
  }
  
  // For production, use PUBLIC_SITE_URL if available
  if (PUBLIC_SITE_URL) {

    return PUBLIC_SITE_URL.replace(/\/$/, "");
  }


  return currentOrigin;
}

function isLocalHost(hostname = "") {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

// Session cookie utilities for local OAuth
function getSessionCookie(req) {
  const cookies = (req.get("cookie") || "").split(";").map((c) => c.trim());
  const sessionCookie = cookies.find((c) => c.startsWith("listflair_session="));
  if (!sessionCookie) return null;
  return sessionCookie.split("=")[1];
}

function setSessionCookie(res, sessionId) {
  res.set("Set-Cookie", `listflair_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
}

// OAuth token exchange
async function exchangeGitHubCode(code) {
  const url = "https://github.com/login/oauth/access_token";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data.access_token;
  } catch (error) {
    console.error("GitHub token exchange failed:", error);
    throw error;
  }
}

// Fetch GitHub user info
async function getGitHubUser(accessToken) {
  try {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `token ${accessToken}`,
        Accept: "application/vnd.github.v3+json"
      }
    });
    if (!response.ok) throw new Error("Failed to fetch user");
    return await response.json();
  } catch (error) {
    console.error("GitHub user fetch failed:", error);
    throw error;
  }
}

// Create mock principal like Azure Easy Auth
function createGitHubPrincipal(githubUser) {
  return {
    auth_typ: "github",
    userId: `github:${githubUser.id}`,
    userDetails: githubUser.login,
    claims: [
      { typ: "name", val: githubUser.name || githubUser.login },
      { typ: "preferred_username", val: githubUser.login }
    ]
  };
}

function getAuthUrls(req) {
  const origin = getSiteOrigin(req);
  // Check if the origin is localhost (more reliable than req.hostname which may be null)
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("[::1]");
  

  
  if (isLocal) {
    // Local OAuth flow
    const returnUrl = encodeURIComponent(`${origin}/`);
    const loginUrl = `/auth/login/github?redirect_uri=${returnUrl}`;
    const logoutUrl = `/auth/logout?redirect_uri=${returnUrl}`;

    return { loginUrl, logoutUrl, provider: DEFAULT_AUTH_PROVIDER };
  }
  
  // Production Azure Easy Auth
  const returnUrl = encodeURIComponent(`${origin}/`);
  const loginUrl = `/.auth/login/${DEFAULT_AUTH_PROVIDER}?post_login_redirect_uri=${returnUrl}`;
  const logoutUrl = `/.auth/logout?post_logout_redirect_uri=${returnUrl}`;

  return { loginUrl, logoutUrl, provider: DEFAULT_AUTH_PROVIDER };
}

function decodeClientPrincipalHeader(headerValue) {
  if (typeof headerValue !== "string" || !headerValue.trim()) {
    return null;
  }

  try {
    const decoded = Buffer.from(headerValue, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (_error) {
    return null;
  }
}

function getClaimValue(claims = [], claimType) {
  const match = claims.find((claim) => claim.typ === claimType);
  return typeof match?.val === "string" ? match.val : "";
}

function buildUserContext(req) {
  // First check for local session (localhost OAuth)
  const origin = getSiteOrigin(req);
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("[::1]");
  

  
  if (isLocal) {
    const sessionId = getSessionCookie(req);

    if (sessionId && localSessions.has(sessionId)) {
      const principal = localSessions.get(sessionId);
      const claims = Array.isArray(principal.claims) ? principal.claims : [];
      const displayName =
        principal.userDetails ||
        getClaimValue(claims, "name") ||
        getClaimValue(claims, "preferred_username") ||
        "";
      const principalId = principal.userId || "";
      const ownerKey = `${principal.auth_typ}:${principalId}`.slice(0, 200);

      return {
        key: ownerKey,
        isAuthenticated: true,
        displayName: displayName || "Signed-in User"
      };
    }

  }

  // Fall back to Azure Easy Auth headers (production)

  const principal = decodeClientPrincipalHeader(req.get("x-ms-client-principal"));
  const claims = Array.isArray(principal?.claims) ? principal.claims : [];
  const provider = req.get("x-ms-client-principal-idp") || principal?.auth_typ || "local";
  const principalId =
    req.get("x-ms-client-principal-id") ||
    principal?.userId ||
    getClaimValue(claims, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier") ||
    getClaimValue(claims, "sub") ||
    "";

  const displayName =
    req.get("x-ms-client-principal-name") ||
    principal?.userDetails ||
    getClaimValue(claims, "name") ||
    getClaimValue(claims, "preferred_username") ||
    "";

  const hasAuthenticatedIdentity = Boolean(principalId);

  if (!hasAuthenticatedIdentity) {

    return {
      key: LOCAL_DEV_USER_KEY,
      isAuthenticated: false,
      displayName: "Local User"
    };
  }

  const ownerKey = `${provider}:${principalId}`.slice(0, 200);
  return {
    key: ownerKey,
    isAuthenticated: true,
    displayName: displayName || "Signed-in User"
  };
}

async function sendIndexHtml(req, res, next) {
  try {
    const template = await fs.readFile(INDEX_HTML_PATH, "utf8");
    const siteOrigin = getSiteOrigin(req);
    const html = template.replace(/__SITE_ORIGIN__/g, siteOrigin);
    res.type("html").send(html);
  } catch (error) {
    next(error);
  }
}

app.get(["/", "/index.html"], sendIndexHtml);
app.use(express.static(path.join(__dirname), { index: false }));
app.use("/generated-images", express.static(GENERATED_IMAGE_DIR));
app.use((req, _res, next) => {

  req.userContext = buildUserContext(req);

  next();
});

app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    return next();
  }

  // Public endpoints that don't require auth
  if (req.path === "/api/health" || req.path === "/api/me" || req.path === "/api/dev/login") {
    return next();
  }

  // All other API endpoints require authentication
  if (!req.userContext.isAuthenticated) {
    const authUrls = getAuthUrls(req);
    return res.status(401).json({
      error: "Sign in required",
      loginUrl: authUrls.loginUrl,
      provider: authUrls.provider
    });
  }

  return next();
});

// Local OAuth Routes (localhost only)
app.get("/auth/login/github", (req, res) => {
  const origin = getSiteOrigin(req);
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("[::1]");
  if (!isLocal) {
    return res.status(404).json({ error: "Not found" });
  }

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.status(500).json({ error: "Local GitHub OAuth is not configured" });
  }

  const redirectUri = encodeURIComponent(`${origin}/auth/callback/github`);
  const scope = encodeURIComponent("user:email");
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${redirectUri}&scope=${scope}`;
  res.redirect(githubAuthUrl);
});

app.get("/auth/callback/github", async (req, res) => {
  const origin = getSiteOrigin(req);
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("[::1]");
  if (!isLocal) {
    return res.status(404).json({ error: "Not found" });
  }

  if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
    return res.redirect(`/?error=oauth_not_configured`);
  }

  const { code, state } = req.query;
  const redirectUri = req.query.redirect_uri || "/";

  if (!code) {
    return res.redirect(`${redirectUri}?error=no_code`);
  }

  try {
    const accessToken = await exchangeGitHubCode(code);
    const githubUser = await getGitHubUser(accessToken);
    const principal = createGitHubPrincipal(githubUser);

    // Store in local session
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localSessions.set(sessionId, principal);

    // Set session cookie and redirect
    setSessionCookie(res, sessionId);
    res.redirect(redirectUri);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.redirect(`${redirectUri}?error=auth_failed`);
  }
});

app.get("/auth/logout", (req, res) => {
  const origin = getSiteOrigin(req);
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("[::1]");
  if (isLocal) {
    const sessionId = getSessionCookie(req);
    if (sessionId) {
      localSessions.delete(sessionId);
      res.set("Set-Cookie", "listflair_session=; Path=/; HttpOnly; Max-Age=0");
    }
  }

  const redirectUri = req.query.redirect_uri || "/";
  res.redirect(redirectUri);
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/me", async (req, res) => {

  const authUrls = getAuthUrls(req);
  const username = req.userContext.isAuthenticated ? await getUsername(req.userContext.key) : null;
  const origin = getSiteOrigin(req);
  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1") || origin.includes("[::1]");
  const response = {
    isAuthenticated: req.userContext.isAuthenticated,
    displayName: req.userContext.displayName,
    username,
    loginUrl: authUrls.loginUrl,
    logoutUrl: authUrls.logoutUrl,
    authProvider: authUrls.provider,
    _debug: { origin, isLocal, userContextKey: req.userContext.key }
  };

  res.json(response);
});

app.get("/api/listflair", async (req, res) => {
  const { size } = req.query;
  const payload = await getListflair(req.userContext.key, size);
  res.json(payload);
});

app.post("/api/user", async (req, res) => {
  const { username } = req.body || {};
  if (typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "username is required and must be a non-empty string" });
  }

  try {
    const success = await setUsername(req.userContext.key, username);
    if (!success) {
      return res.status(409).json({ error: "Username is already taken" });
    }
    const updated = await getUsername(req.userContext.key);
    res.json({ username: updated });
  } catch (error) {
    console.error("Failed to set username:", error);
    res.status(500).json({ error: "Could not set username" });
  }
});

app.get("/api/user", async (req, res) => {
  if (!req.userContext.isAuthenticated) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const username = await getUsername(req.userContext.key);
  res.json({ username });
});
app.post("/api/dev/login", async (req, res) => {
  if (!isLocalHost("localhost")) {
    return res.status(403).json({ error: "Dev endpoint only available on localhost" });
  }

  const { username, displayName } = req.body || {};
  if (typeof username !== "string" || !username.trim()) {
    return res.status(400).json({ error: "username is required" });
  }
  if (typeof displayName !== "string" || !displayName.trim()) {
    return res.status(400).json({ error: "displayName is required" });
  }

  try {
    const devKey = `dev-local:${username.trim().toLowerCase().slice(0, 50)}`;
    const success = await setUsername(devKey, username.trim());
    if (!success) {
      return res.status(409).json({ error: "Username already taken" });
    }

    const principal = {
      auth_typ: "local-dev",
      userId: devKey,
      userDetails: displayName.trim(),
      claims: []
    };

    res.json({
      message: "Dev user created for local testing",
      devKey,
      username: username.trim(),
      displayName: displayName.trim(),
      principal: Buffer.from(JSON.stringify(principal)).toString("base64")
    });
  } catch (error) {
    console.error("Dev login error:", error);
    res.status(500).json({ error: "Could not create dev user" });
  }
});
app.post("/api/entries", async (req, res) => {
  const { name, category } = req.body || {};
  if (!name || !category || typeof name !== "string" || typeof category !== "string") {
    return res.status(400).json({ error: "name and category are required strings" });
  }
  const entry = await addEntry(req.userContext.key, name.trim().slice(0, 200), category.trim().slice(0, 80));
  res.status(201).json(entry);
});

app.patch("/api/entries/reorder", async (req, res) => {
  const { orderedIds } = req.body || {};
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
    return res.status(400).json({ error: "orderedIds must be a non-empty array" });
  }

  const successful = await reorderEntries(req.userContext.key, orderedIds);
  if (!successful) {
    return res.status(400).json({ error: "Invalid reorder payload" });
  }

  return res.json({ ok: true });
});

app.delete("/api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const existingEntry = await getEntry(req.userContext.key, id);
  const deleted = await deleteEntry(req.userContext.key, id);
  if (!deleted) {
    return res.status(404).json({ error: "Entry not found" });
  }

  const favorites = await listFavoriteImages(req.userContext.key, id);
  await removeAllFavoriteImagesForEntry(req.userContext.key, id);

  if (existingEntry?.imageUrl) {
    await removeCachedImage(existingEntry.imageUrl);
  }
  for (const image of favorites) {
    if (image.imageUrl && image.imageUrl !== existingEntry?.imageUrl) {
      await removeCachedImage(image.imageUrl);
    }
  }

  res.json({ ok: true, deleted: id });
});

app.patch("/api/entries/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, category } = req.body || {};
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }
  if (!name || !category || typeof name !== "string" || typeof category !== "string") {
    return res.status(400).json({ error: "name and category are required strings" });
  }
  const existingEntry = await getEntry(req.userContext.key, id);
  const updated = await updateEntry(req.userContext.key, id, name.trim().slice(0, 200), category.trim().slice(0, 80));
  if (!updated) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (existingEntry?.imageUrl) {
    await removeImageIfNotFavorited(req.userContext.key, id, existingEntry.imageUrl);
  }

  res.json(updated);
});

app.get("/api/entries/:id/favorites", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const viewerData = await getEntryViewerImages(req.userContext.key, id);
  if (!viewerData) {
    return res.status(404).json({ error: "Entry not found" });
  }

  return res.json({
    entryId: id,
    currentImageUrl: viewerData.entry.imageUrl || null,
    images: viewerData.images
  });
});

app.post("/api/entries/:id/favorites", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const { imageUrl, favorite, imageSource, imageQuery } = req.body || {};
  if (!imageUrl || typeof imageUrl !== "string") {
    return res.status(400).json({ error: "imageUrl is required" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (favorite) {
    await addFavoriteImage(
      req.userContext.key,
      id,
      imageUrl,
      typeof imageSource === "string" ? imageSource : null,
      typeof imageQuery === "string" ? imageQuery.slice(0, 500) : null
    );
  } else {
    const removed = await removeFavoriteImage(req.userContext.key, id, imageUrl);
    if (removed && entry.imageUrl !== imageUrl) {
      await removeCachedImage(imageUrl);
    }
  }

  const viewerData = await getEntryViewerImages(req.userContext.key, id);
  return res.json({
    entryId: id,
    currentImageUrl: viewerData.entry.imageUrl || null,
    images: viewerData.images
  });
});

app.get("/api/entries/:id/image/search", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 200) : "";
  if (!q) {
    return res.status(400).json({ error: "q is required" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  const results = await searchWebImages(q);
  res.json({ results });
});

app.get("/api/entries/:id/image", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  sendImagePayload(res, entry);
});

app.post("/api/entries/:id/image", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (entry.imageStatus === "ready" && entry.imageUrl) {
    return sendImagePayload(res, entry);
  }

  if (entry.imageStatus !== "loading") {
    await markEntryImageLoading(req.userContext.key, id, getRequestedImageIndex(entry));
  }

  startImageLookup(req.userContext.key, id);
  const loadingEntry = await getEntry(req.userContext.key, id);
  return sendImagePayload(res, loadingEntry, 202);
});

app.post("/api/entries/:id/image/refresh", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (entry.imageStatus === "loading") {
    return sendImagePayload(res, entry, 202);
  }

  await markEntryImageLoading(req.userContext.key, id, getRequestedImageIndex(entry, true));
  startImageLookup(req.userContext.key, id);
  const loadingEntry = await getEntry(req.userContext.key, id);
  return sendImagePayload(res, loadingEntry, 202);
});

app.post("/api/entries/:id/image/pick", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    return res.status(400).json({ error: "Invalid id" });
  }

  const { fetchUrl, thumbnailUrl, sourceUrl, query } = req.body || {};
  if (!fetchUrl || typeof fetchUrl !== "string") {
    return res.status(400).json({ error: "fetchUrl is required" });
  }
  if (!fetchUrl.startsWith("https://")) {
    return res.status(400).json({ error: "fetchUrl must use https" });
  }

  const entry = await getEntry(req.userContext.key, id);
  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  try {
    const cached = await cacheSelectedImage(entry, {
      fetchUrl,
      thumbnailUrl: typeof thumbnailUrl === "string" ? thumbnailUrl : fetchUrl,
      sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null,
      query: typeof query === "string" ? query.slice(0, 500) : ""
    });

    await setEntryImageAndCleanupPrevious(req.userContext.key, id, {
      imageUrl: cached.imageUrl,
      imageSource: cached.imageSource,
      imageQuery: cached.imageQuery,
      imageResultIndex: 0
    });

    const updatedEntry = await getEntry(req.userContext.key, id);
    return sendImagePayload(res, updatedEntry);
  } catch (error) {
    await setEntryImageError(req.userContext.key, id, error.message);
    return res.status(500).json({ error: "Could not cache the selected image" });
  }
});

async function startServer() {
  await initializeDatabase();

  const databaseMode = USE_AZURE_SQL ? "Azure SQL" : "SQLite (local)";
  const imageCacheMode = USE_BLOB_STORAGE
    ? `Azure Blob (${STORAGE_CONTAINER})`
    : "Local filesystem (data/generated-images)";

  console.log(`[startup] Database mode: ${databaseMode}`);
  console.log(`[startup] Image cache mode: ${imageCacheMode}`);

  app.listen(PORT, () => {
    console.log(`ListFlair service running at http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
