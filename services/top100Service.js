const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const ITEM_POOL = [
  { name: "Funk Basslines", category: "music" },
  { name: "Psychedelic Posters", category: "art" },
  { name: "Cult Classic Films", category: "movies" },
  { name: "Game-Winning Buzzer Beaters", category: "sports" },
  { name: "Mixtape Era Hip-Hop", category: "music" },
  { name: "Indie Film Soundtracks", category: "movies" },
  { name: "Studio Ghibli Worlds", category: "animation" },
  { name: "Skate Video Parts", category: "sports" },
  { name: "Streetwear Grails", category: "style" },
  { name: "Late Night Monologues", category: "entertainment" },
  { name: "Political Comeback Stories", category: "politics" },
  { name: "Underground Zines", category: "culture" },
  { name: "Space Telescope Images", category: "science" },
  { name: "Rocket Launch Clips", category: "science" },
  { name: "The Golden Age of Arcades", category: "gaming" },
  { name: "Open-World RPG Quests", category: "gaming" },
  { name: "Legendary Rivalries", category: "sports" },
  { name: "A24 Mood Pieces", category: "movies" },
  { name: "Iconic Protest Songs", category: "music" },
  { name: "Deep-Sea Mysteries", category: "science" },
  { name: "Historic Supreme Court Moments", category: "politics" },
  { name: "Festival Main Stages", category: "music" },
  { name: "Street Food Night Markets", category: "food" },
  { name: "Goal-Line Stands", category: "sports" },
  { name: "Comedy Duo Chemistry", category: "entertainment" },
  { name: "Mind-Bending Documentaries", category: "movies" },
  { name: "Legendary Album Openers", category: "music" },
  { name: "Sneaker Colorways", category: "style" },
  { name: "Impossible Magic Tricks", category: "entertainment" },
  { name: "City Pop Comebacks", category: "music" },
  { name: "Virtual Reality Worlds", category: "tech" },
  { name: "Street Photography", category: "art" },
  { name: "Debate Night Moments", category: "politics" },
  { name: "Champion Underdog Runs", category: "sports" },
  { name: "All-Time Sitcom Episodes", category: "tv" },
  { name: "Lo-Fi Study Loops", category: "music" },
  { name: "Classic Anime Transformations", category: "animation" },
  { name: "Cold-Case Breakthroughs", category: "interesting" },
  { name: "Space-Time Paradoxes", category: "interesting" },
  { name: "Board Game Comebacks", category: "gaming" },
  { name: "World Cup Chaos", category: "sports" },
  { name: "Practical Movie Effects", category: "movies" },
  { name: "Unforgettable Oscar Speeches", category: "movies" },
  { name: "Tiny Desk Performances", category: "music" },
  { name: "Classic Sci-Fi Book Covers", category: "books" },
  { name: "Conspiracy Theories (Debunked)", category: "interesting" },
  { name: "Stand-Up Crowd Work", category: "entertainment" },
  { name: "Mountain Summit Photos", category: "nature" },
  { name: "Revolutionary Inventions", category: "history" },
  { name: "Trailblazing Mayors", category: "politics" },
  { name: "Late Career Reinventions", category: "entertainment" },
  { name: "Synthwave Nights", category: "music" },
  { name: "Film Noir Shadows", category: "movies" },
  { name: "National Park Hikes", category: "nature" },
  { name: "Tech Demos That Changed Everything", category: "tech" },
  { name: "Epic Chess Endgames", category: "games" },
  { name: "Legendary DJ Sets", category: "music" },
  { name: "Perfectly Timed Heist Scenes", category: "movies" },
  { name: "Wildlife Rescue Stories", category: "nature" },
  { name: "Parallel Universe Fiction", category: "books" },
  { name: "Boxing Ring Walks", category: "sports" },
  { name: "Breakthrough Vaccine Science", category: "science" },
  { name: "Unexpected Coalition Wins", category: "politics" },
  { name: "Classic Car Designs", category: "style" },
  { name: "Meme Formats That Never Die", category: "internet" },
  { name: "Space Opera Soundtracks", category: "music" },
  { name: "Supercut Editing", category: "entertainment" },
  { name: "Grandmaster Bluffs", category: "games" },
  { name: "Historic Speeches", category: "history" },
  { name: "Best Plot Twists", category: "tv" },
  { name: "Unreal Dunks", category: "sports" },
  { name: "Bioluminescent Beaches", category: "nature" },
  { name: "Streetball Legends", category: "sports" },
  { name: "Science Fair Legends", category: "science" },
  { name: "Cloud Rap Atmospheres", category: "music" },
  { name: "Epic Boss Battles", category: "gaming" },
  { name: "Political Satire Sketches", category: "entertainment" },
  { name: "Historic Courtroom Showdowns", category: "politics" },
  { name: "Neo-Soul Classics", category: "music" },
  { name: "Extreme Weather Chasers", category: "interesting" },
  { name: "DIY Home Studios", category: "music" },
  { name: "Mindful Morning Rituals", category: "lifestyle" },
  { name: "Unsolved Archaeological Finds", category: "history" },
  { name: "Creative Coding Art", category: "tech" },
  { name: "Skyscraper Engineering", category: "science" },
  { name: "Rocket League Overtime Goals", category: "gaming" },
  { name: "Retro Future Fashion", category: "style" },
  { name: "Legendary Voice-Over Performances", category: "entertainment" },
  { name: "Comedy Timing Masters", category: "entertainment" },
  { name: "Festival Camping Stories", category: "culture" },
  { name: "Midnight Diner Episodes", category: "tv" },
  { name: "Famous Rival Political Ads", category: "politics" },
  { name: "Psychological Thrillers", category: "movies" },
  { name: "Tabletop Mini Painting", category: "games" },
  { name: "Street Dance Battles", category: "culture" },
  { name: "Impossible Photo Finishes", category: "sports" },
  { name: "Future Cities Concepts", category: "tech" },
  { name: "Classic Radio Voices", category: "history" },
  { name: "Indie Puzzle Games", category: "gaming" },
  { name: "Martial Arts Choreography", category: "movies" },
  { name: "The Best Cold Opens", category: "tv" },
  { name: "Ocean Exploration ROV Footage", category: "science" },
  { name: "Documentary Narration Voices", category: "entertainment" },
  { name: "Historic Peace Treaties", category: "politics" },
  { name: "Desert Rally Highlights", category: "sports" },
  { name: "Iconic Tiny Movie Props", category: "movies" },
  { name: "Folk Revival Songwriters", category: "music" },
  { name: "Basement Show Flyers", category: "culture" },
  { name: "Improv Scenes Gone Right", category: "entertainment" },
  { name: "Trail Running Sunrises", category: "nature" },
  { name: "Social Movement Posters", category: "politics" },
  { name: "Space Capsule Re-Entry", category: "science" },
  { name: "Legendary Goalkeeper Saves", category: "sports" },
  { name: "Festival Documentary Shorts", category: "movies" },
  { name: "Lost Civilizations", category: "history" },
  { name: "Open Source Breakthroughs", category: "tech" },
  { name: "World-Building Maps", category: "books" },
  { name: "All-Time Karaoke Songs", category: "music" },
  { name: "Speedrun World Records", category: "gaming" },
  { name: "Street Interview Gold", category: "internet" },
  { name: "Surprise Album Drops", category: "music" },
  { name: "Stunt Sequences", category: "movies" },
  { name: "Election Night Graphics", category: "politics" },
  { name: "Historic Championship Rings", category: "sports" },
  { name: "Public Transit Design", category: "tech" },
  { name: "Time-Lapse Art", category: "art" },
  { name: "Desert Island Books", category: "books" },
  { name: "Space Colony Concepts", category: "science" },
  { name: "Slam Poetry Finals", category: "culture" },
  { name: "Amazing Race Strategy", category: "tv" },
  { name: "Volcanic Lightning", category: "nature" },
  { name: "Street Magic Reactions", category: "entertainment" },
  { name: "Cult Podcast Episodes", category: "internet" },
  { name: "Cyberpunk Cityscapes", category: "art" },
  { name: "Olympic Opening Ceremonies", category: "sports" },
  { name: "Remote Island Adventures", category: "nature" },
  { name: "Finale Episodes That Landed", category: "tv" },
  { name: "Underground Comic Panels", category: "art" },
  { name: "Iconic Mic Drops", category: "politics" },
  { name: "All-Night Hackathons", category: "tech" },
  { name: "Late-Night Food Trucks", category: "food" },
  { name: "Esports Reverse Sweeps", category: "gaming" },
  { name: "Studio Outtakes", category: "entertainment" },
  { name: "Innovative Camera Rigs", category: "movies" },
  { name: "Historic Bridge Builds", category: "history" },
  { name: "Legendary Album Closers", category: "music" },
  { name: "Viral Science Demos", category: "science" },
  { name: "Playoff Walk-Off Homers", category: "sports" },
  { name: "Counterculture Fashion", category: "style" },
  { name: "Live-Looping Artists", category: "music" },
  { name: "Minimalist Architecture", category: "style" },
  { name: "NASA Mission Patches", category: "science" },
  { name: "Prank Show Classics", category: "tv" },
  { name: "Historic Policy Reforms", category: "politics" },
  { name: "Unlikely Duo Collaborations", category: "music" },
  { name: "Film Festival Q&As", category: "movies" },
  { name: "Legendary Fishing Tales", category: "interesting" },
  { name: "Underground Transit Maps", category: "tech" },
  { name: "Jazz Fusion Solos", category: "music" },
  { name: "Meteor Shower Timelapses", category: "nature" },
  { name: "Famous Museum Heists", category: "history" },
  { name: "Classic One-Liners", category: "movies" },
  { name: "Political Memoirs", category: "books" },
  { name: "Historic Triple Doubles", category: "sports" },
  { name: "Street Mural Projects", category: "art" },
  { name: "Experimental Theater Nights", category: "culture" },
  { name: "Backyard Astronomy", category: "science" },
  { name: "Puzzle Box Mysteries", category: "interesting" },
  { name: "Global Dance Crazes", category: "culture" },
  { name: "Skyline Drone Footage", category: "tech" },
  { name: "Neo-Western Stories", category: "movies" },
  { name: "Legendary Press Conferences", category: "sports" },
  { name: "Classic News Blooper Reels", category: "entertainment" },
  { name: "Coastal Road Trips", category: "travel" },
  { name: "Epic Penalty Shootouts", category: "sports" },
  { name: "Comic-Con Cosplay Builds", category: "culture" },
  { name: "Career-Defining Roles", category: "movies" },
  { name: "Political Debate One-Liners", category: "politics" },
  { name: "International Street Art", category: "art" },
  { name: "Unexpected Duets", category: "music" },
  { name: "Underground Food Scenes", category: "food" },
  { name: "City Marathon Atmosphere", category: "sports" },
  { name: "Legendary Post-Credit Scenes", category: "movies" },
  { name: "Famous TV Theme Songs", category: "tv" },
  { name: "Historic Innovation Labs", category: "tech" }
];

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "top100.sqlite");

let db;

function getDatabase() {
  if (db) {
    return db;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  return db;
}

function initializeDatabase() {
  const database = getDatabase();

  database.exec(`
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const existingCount = database
    .prepare("SELECT COUNT(1) AS count FROM entries")
    .get().count;

  if (existingCount === 0) {
    const insertEntry = database.prepare(
      "INSERT INTO entries (name, category) VALUES (?, ?)"
    );
    const seedEntries = database.transaction((items) => {
      for (const item of items) {
        insertEntry.run(item.name, item.category);
      }
    });
    seedEntries(ITEM_POOL);
  }
}

function getTop100(size = 100) {
  const normalized = Number.isNaN(Number(size)) ? 100 : Number(size);
  const cappedSize = Math.max(1, Math.min(normalized, 100));
  const database = getDatabase();

  const selection = database
    .prepare(
      "SELECT id, name, category FROM entries ORDER BY RANDOM() LIMIT ?"
    )
    .all(cappedSize);

  return {
    generatedAt: new Date().toISOString(),
    count: selection.length,
    items: selection
  };
}

function deleteEntry(id) {
  const database = getDatabase();
  const result = database
    .prepare("DELETE FROM entries WHERE id = ?")
    .run(id);
  return result.changes > 0;
}

module.exports = {
  initializeDatabase,
  getTop100,
  deleteEntry
};
