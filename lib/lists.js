const fs = require("fs");
const path = require("path");

const API_BASE = "https://am0oduviqd.execute-api.us-east-1.amazonaws.com/dev";
const API_KEY = process.env.MARKET_AGGREGATOR_API_KEY || "";
const DATA_DIR = path.join(__dirname, "..", "data");
const SNAPSHOT_FILE = path.join(DATA_DIR, "lists-cache.json");
const MAX_PAGE_FETCHES = 100;
const CAN_WRITE_SNAPSHOT = !process.env.VERCEL;

const NAME_ALIASES = {
  "rob bresnahan jr": ["rob bresnahan jr.", "robert bresnahan jr", "robert bresnahan jr."],
  "sarah mcbride": ["sarah mc bride"],
  "james clyburn": ["jim clyburn"],
  "james jordan": ["jim jordan"],
  "michael johnson": ["mike johnson"],
  "michael lee": ["mike lee"],
  "michael pence": ["mike pence"],
};

let cachedPayload = null;

async function fetchJson(endpoint) {
  if (!API_KEY) {
    throw new Error("MARKET_AGGREGATOR_API_KEY is not set");
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      "x-api-key": API_KEY,
    },
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function fetchPeoplePages() {
  const people = [];
  let cursor = null;

  for (let page = 0; page < MAX_PAGE_FETCHES; page += 1) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const response = await fetchJson(`/v1/people${query}`);
    people.push(...(response.data || []));

    if (!response.pagination?.hasNext || !response.pagination?.nextCursor) {
      break;
    }

    cursor = response.pagination.nextCursor;
  }

  return people;
}

function isFederalCongressPerson(person) {
  const institution = person.scope?.institution || "";
  return (
    institution === "U.S. House of Representatives" ||
    institution === "U.S. Senate"
  );
}

function normalizePerson(person) {
  return {
    id: person.id,
    name: person.name || person.full_name || "Unknown",
    photoUrl: person.photo_url,
    age: person.bio?.age ?? null,
    birthday: person.bio?.birthday ?? null,
    gender: person.bio?.gender ?? null,
    party: person.scope?.party || "Independent",
    office: person.scope?.office_title || person.scope?.institution || "Unknown office",
    state: person.scope?.jurisdiction?.state || "National",
    district: person.scope?.jurisdiction?.district || null,
    incumbent: Boolean(person.scope?.incumbent),
    summary: person.bio?.summary || "No summary available.",
  };
}

function normalizeMarket(marketResponse) {
  const market = marketResponse?.market || {};
  return {
    id: market.id,
    question: market.question || "Unknown market",
    uiTitle: market.uiTitle || market.question || "Unknown market",
    eventTitle: market.eventTitle || "Untitled event",
    probability: Number(market.lastTradePrice ?? market.outcomePrices?.[0] ?? 0),
    volume: Number(market.volumeNum ?? market.volume ?? 0),
    status: market.status || "unknown",
    platformUrl: market.platformUrls?.kalshi || null,
  };
}

async function enrichWithMarkets(person) {
  const marketIdsResponse = await fetchJson(`/v1/people/${person.id}/markets`);
  const marketIds = Array.isArray(marketIdsResponse?.marketIds)
    ? marketIdsResponse.marketIds.slice(0, 8)
    : [];

  if (!marketIds.length) {
    return {
      ...person,
      markets: [],
      bestOdds: null,
      worstOdds: null,
      featuredMarket: null,
    };
  }

  const markets = await Promise.all(
    marketIds.map(async (marketId) => normalizeMarket(await fetchJson(`/v1/markets/${marketId}`)))
  );

  markets.sort((a, b) => a.probability - b.probability);

  return {
    ...person,
    markets,
    worstOdds: markets[0]?.probability ?? null,
    bestOdds: markets[markets.length - 1]?.probability ?? null,
    featuredMarket: markets[markets.length - 1] || markets[0] || null,
  };
}

function topN(items, sorter, filterFn = () => true, limit = 12) {
  return items.filter(filterFn).sort(sorter).slice(0, limit);
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function writeSnapshot(payload) {
  if (!CAN_WRITE_SNAPSHOT) {
    return;
  }

  ensureDataDir();
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(payload, null, 2));
}

function safeWriteSnapshot(payload) {
  try {
    writeSnapshot(payload);
  } catch (_error) {
  }
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
}

function normalizeNameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(jr|sr)\.?\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function createPeopleIndex(people) {
  const index = new Map();

  people.forEach((person) => {
    const normalized = normalizeNameKey(person.name);
    if (normalized && !index.has(normalized)) {
      index.set(normalized, person);
    }

    const aliases = NAME_ALIASES[normalized] || [];
    aliases.forEach((alias) => {
      const aliasKey = normalizeNameKey(alias);
      if (aliasKey && !index.has(aliasKey)) {
        index.set(aliasKey, person);
      }
    });
  });

  return index;
}

function createRankedSection({ key, eyebrow, title, items, stat, market }) {
  return {
    key,
    eyebrow,
    title,
    items: items.map((person, index) => ({
      rank: index + 1,
      name: person.name,
      photoUrl: person.photoUrl || null,
      meta: `${person.party} - ${person.office} - ${person.state}`,
      stat: stat(person),
      market: market(person),
      summary: person.summary,
    })),
  };
}

function createEditorialSection({ key, eyebrow, title, items }) {
  return {
    key,
    eyebrow,
    title,
    items: items.map((item, index) => ({
      rank: index + 1,
      name: item.name,
      photoUrl: item.photoUrl || null,
      meta: item.meta || "Member of Congress",
      stat: item.stat || "",
      market: item.market || "",
      summary: item.summary || "",
    })),
  };
}

function getEditorialEntry(peopleByName, name, fallback) {
  const match = peopleByName.get(normalizeNameKey(name));
  return {
    name,
    photoUrl: match?.photoUrl || null,
    meta:
      fallback.meta ||
      (match ? `${match.party} - ${match.office} - ${match.state}` : "Member of Congress"),
    stat: fallback.stat || "",
    market: fallback.market || "",
    summary: fallback.summary || "",
  };
}

function createEditorialSections(peopleByName) {
  return [
    createEditorialSection({
      key: "oldestCurrentMembers",
      eyebrow: "Age rank",
      title: "Oldest Members of Congress",
      items: [
        ["Chuck Grassley", "91", "Oldest sitting member in this list"],
        ["Hal Rogers", "87", "Senior House member"],
        ["Maxine Waters", "86", "Long-serving House member"],
        ["Steny Hoyer", "85", "Long-serving House leader"],
        ["James Clyburn", "84", "Veteran House leader"],
        ["Nancy Pelosi", "84", "Former House speaker"],
        ["Bernie Sanders", "83", "Senior senator from Vermont"],
        ["John Carter", "83", "Senior House member from Texas"],
        ["Mitch McConnell", "82", "Longtime Senate leader"],
        ["Jim Risch", "81", "Senior senator from Idaho"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "youngestCurrentMembers",
      eyebrow: "Age rank",
      title: "Youngest Members of Congress",
      items: [
        ["Maxwell Frost", "27", "Youngest sitting member in this list"],
        ["Addison McDowell", "30", "Among the youngest House members"],
        ["Brandon Gill", "30", "Among the youngest House members"],
        ["Yassamin Ansari", "32", "Young House member from Arizona"],
        ["Abraham Hamadeh", "33", "Young House member from Arizona"],
        ["Sarah McBride", "34", "Young House member from Delaware"],
        ["Rob Bresnahan Jr.", "34", "Young House member from Pennsylvania"],
        ["Sara Jacobs", "35", "Young House member from California"],
        ["Alexandria Ocasio-Cortez", "35", "High-profile young House member"],
        ["Anna Paulina Luna", "35", "Young House member from Florida"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "twoFirstNames",
      eyebrow: "Name list",
      title: "Congressmen With Two First Names",
      items: [
        ["Tim Scott", "Two first names", "Senator from South Carolina"],
        ["Rick Scott", "Two first names", "Senator from Florida"],
        ["Mike Lee", "Two first names", "Senator from Utah"],
        ["Ron Johnson", "Two first names", "Senator from Wisconsin"],
        ["Jim Jordan", "Two first names", "Representative from Ohio"],
        ["Mike Johnson", "Two first names", "Representative from Louisiana"],
        ["Scott Perry", "Two first names", "Representative from Pennsylvania"],
        ["Tom Cole", "Two first names", "Representative from Oklahoma"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "vegetariansVegans",
      eyebrow: "Food politics",
      title: "Known Vegetarians / Vegans in Congress",
      items: [
        ["Cory Booker", "Vegan", "One of the best-known vegan members of Congress"],
        ["Ro Khanna", "Vegetarian", "Publicly associated with a vegetarian diet"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "baldMembers",
      eyebrow: "Hairline caucus",
      title: "Fully Bald Members of Congress",
      items: [
        ["Rick Scott", "Fully shaved", "Consistently keeps a completely smooth shaved head"],
        ["John Fetterman", "Fully shaved", "Known for a fully shaved head and signature goatee"],
        ["Cory Booker", "Fully bald", "Has worn a clean-shaven bald look throughout his national career"],
        ["Ayanna Pressley", "Bald", "Public advocate on alopecia who often appears with a smooth bald head"],
        ["Hakeem Jeffries", "Tightly shaved", "Keeps a very clean tightly shaved head"],
        ["Greg Steube", "Closely shaved", "Keeps his head shaved to the point of appearing fully bald"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "disneyWorld",
      eyebrow: "Confirmed travel",
      title: "Members of Congress Who Have Been to Disney World",
      items: [
        getEditorialEntry(peopleByName, "Lindsey Graham", {
          stat: "Best documented example",
          market: "Photographed and widely reported Disney World visit",
          summary:
            "Caught on camera during a congressional recess, including ride lines, restaurants, and carrying a bubble wand. The trip became part of the shutdown-era media cycle.",
        }),
      ],
    }),
    createEditorialSection({
      key: "wealthiestMembers",
      eyebrow: "Net worth",
      title: "Pre-Politics Wealth Heavyweights",
      items: [
        ["Jim Justice", "~$1B+", "Coal and resort empire"],
        ["Rick Scott", "~$500M+", "Hospital company founder"],
        ["Mark Warner", "~$200M+", "Venture capital"],
        ["Pete Ricketts", "~$200M+", "TD Ameritrade family"],
        ["Mitt Romney", "~$200M+", "Bain Capital"],
        ["Darrell Issa", "~$400M+", "Car alarm business"],
        ["Markwayne Mullin", "~$60M-$70M", "Plumbing business"],
        ["Suzan DelBene", "~$70M-$80M", "Microsoft executive"],
        ["Ron Johnson", "~$70M-$80M", "Manufacturing CEO"],
        ["Bill Hagerty", "~$50M+", "Investment firm executive"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "wealthIncrease",
      eyebrow: "Asset growth",
      title: "Biggest Wealth Increases in Congress",
      items: [
        ["Patrick Murphy", "~1400% increase", "One of the steepest reported gains"],
        ["Chellie Pingree", "Massive jump", "Increase tied to marriage and asset consolidation"],
        ["Mike Pence", "Large early-career increase", "Strong growth from a lower early baseline"],
        ["Roy Blunt", "Multi-million gain", "Substantial gain over time in office"],
        ["Loretta Sanchez", "Significant net worth growth", "Large increase reported across tenure"],
        ["Saxby Chambliss", "Large increase", "Notable gains during congressional service"],
        ["Adam Kinzinger", "Strong % growth", "Strong percentage growth from a low base"],
        ["Ted Poe", "Notable increase", "Substantial increase over time"],
        ["Mark Warner", "Continued growth", "Already wealthy, but still increased substantially"],
        ["Nancy Pelosi", "Major long-term growth", "Long-run wealth increase over many years"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "mostAbsent",
      eyebrow: "Missed votes",
      title: "Most Absent Members of Congress",
      items: [
        ["Donald Payne Jr.", "~60%+ missed", "Health-related absence before death"],
        ["Kay Granger", "~40%+ missed", "Late-term absence"],
        ["Nancy Pelosi", "Elevated absences", "Leadership and travel periods pushed absences higher"],
        ["Kevin McCarthy", "Higher missed-vote rate", "Speakership turmoil coincided with missed votes"],
        ["Cori Bush", "Above-average missed votes", "Repeatedly landed above chamber averages"],
        ["Matt Gaetz", "Elevated absences", "Political activity coincided with missed votes"],
        ["Marjorie Taylor Greene", "Higher-than-average", "Missed-vote rate exceeded chamber norm"],
        ["Dean Phillips", "Campaign-related absences", "Presidential run increased missed votes"],
        ["Tim Scott", "Campaign-cycle absences", "National campaign schedule drove missed votes"],
        ["Bernie Sanders", "Historically higher absences", "Travel and campaign activity are recurring factors"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "talkativeMembers",
      eyebrow: "Floor time",
      title: "Yap Leaderboard",
      items: [
        ["Ted Cruz", "21-hour pseudo-filibuster", "One of the best-known marathon Senate speeches"],
        ["Cory Booker", "Marathon speeches", "Frequent long-form floor appearances"],
        ["Bernie Sanders", "Constant floor speeches", "Consistently heavy messaging and floor time"],
        ["Elizabeth Warren", "Heavy policy speech output", "Frequent and detailed policy remarks"],
        ["Chuck Schumer", "Frequent leadership remarks", "Leadership role keeps him on the floor often"],
        ["Kevin McCarthy", "Long leadership speeches", "Extended remarks during leadership fights"],
        ["Hakeem Jeffries", "Record-breaking extended speech", "Set a modern House speech record in 2023"],
        ["Rand Paul", "Multiple filibuster-style speeches", "Known for long liberty-themed floor speeches"],
        ["Chris Murphy", "Gun-control filibuster speeches", "Long Senate floor actions drew national attention"],
        ["Al Green", "Frequent lengthy remarks", "Repeatedly uses floor time for extended statements"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
    createEditorialSection({
      key: "worstTraders",
      eyebrow: "Stock trading",
      title: "Worst Congressional Stock Traders",
      items: [
        ["David Perdue", "Poorly timed frequent trades", "Heavy trading drew scrutiny before 2021"],
        ["Kelly Loeffler", "Mixed performance under scrutiny", "Controversial trades became a major story"],
        ["Tom Malinowski", "Late disclosures", "Trades triggered ethics concerns"],
        ["Blake Moore", "Tech losses", "Reported losses during the tech downturn"],
        ["Markwayne Mullin", "Mixed portfolio results", "Performance lagged broader market benchmarks"],
        ["Dan Crenshaw", "Underperformance", "Disclosed trades trailed the market"],
        ["Sean Patrick Maloney", "Poor timing", "Losses tied to badly timed positions"],
        ["Tom Carper", "Lagging conservative trades", "Conservative trading style still trailed indices"],
        ["Debbie Stabenow", "Low-return positions", "Disclosed holdings underperformed"],
        ["John Hickenlooper", "Passive-style lag", "Returns trailed broader indices"],
      ].map(([name, stat, summary]) => getEditorialEntry(peopleByName, name, { stat, summary })),
    }),
  ];
}

function buildSections(enriched) {
  const formatPercent = (value) => `${Math.round((value || 0) * 100)}%`;
  const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact" });
  const peopleByName = createPeopleIndex(enriched);

  const computedSections = [
    createRankedSection({
      key: "oldestCandidates",
      eyebrow: "Age rank",
      title: "Oldest Candidates",
      items: topN(
        enriched,
        (a, b) => (b.age ?? -1) - (a.age ?? -1),
        (person) => person.age !== null
      ),
      stat: (person) => `Age ${person.age}`,
      market: (person) =>
        person.featuredMarket
          ? `${person.featuredMarket.uiTitle}: ${formatPercent(person.featuredMarket.probability)}`
          : "No linked market odds available",
    }),
    createRankedSection({
      key: "youngestCandidates",
      eyebrow: "Age rank",
      title: "Youngest Candidates",
      items: topN(
        enriched,
        (a, b) => (a.age ?? 999) - (b.age ?? 999),
        (person) => person.age !== null
      ),
      stat: (person) => `Age ${person.age}`,
      market: (person) =>
        person.featuredMarket
          ? `${person.featuredMarket.uiTitle}: ${formatPercent(person.featuredMarket.probability)}`
          : "No linked market odds available",
    }),
    createRankedSection({
      key: "longestShots",
      eyebrow: "Odds rank",
      title: "Lowest Odds Candidates",
      items: topN(
        enriched,
        (a, b) => (a.bestOdds ?? 2) - (b.bestOdds ?? 2),
        (person) => person.bestOdds !== null
      ),
      stat: (person) => `${formatPercent(person.bestOdds)} best linked market odds`,
      market: (person) =>
        person.featuredMarket
          ? `${person.featuredMarket.uiTitle}: ${formatPercent(person.featuredMarket.probability)}`
          : "No linked market odds available",
    }),
    createRankedSection({
      key: "incumbentsInTrouble",
      eyebrow: "Incumbent watch",
      title: "Incumbents In Trouble",
      items: topN(
        enriched,
        (a, b) => (a.bestOdds ?? 2) - (b.bestOdds ?? 2),
        (person) => person.incumbent && person.bestOdds !== null
      ),
      stat: (person) => `${formatPercent(person.bestOdds)} best linked market odds`,
      market: (person) =>
        person.featuredMarket
          ? `${person.featuredMarket.uiTitle}: ${formatPercent(person.featuredMarket.probability)}`
          : "No linked market odds available",
    }),
    createRankedSection({
      key: "womenCandidates",
      eyebrow: "People list",
      title: "Women Candidates",
      items: topN(
        enriched,
        (a, b) => (a.age ?? 999) - (b.age ?? 999),
        (person) => person.gender === "Female"
      ),
      stat: (person) => (person.age !== null ? `Age ${person.age}` : `${person.party} candidate`),
      market: (person) =>
        person.featuredMarket
          ? `${person.featuredMarket.uiTitle}: ${formatPercent(person.featuredMarket.probability)}`
          : "No linked market odds available",
    }),
    createRankedSection({
      key: "topFavorites",
      eyebrow: "Odds rank",
      title: "Strongest Favorites",
      items: topN(
        enriched,
        (a, b) => (b.bestOdds ?? -1) - (a.bestOdds ?? -1),
        (person) => person.bestOdds !== null
      ),
      stat: (person) => `${formatPercent(person.bestOdds)} best linked market odds`,
      market: (person) =>
        person.featuredMarket
          ? `${person.featuredMarket.uiTitle}: ${formatPercent(person.featuredMarket.probability)}`
          : "No linked market odds available",
    }),
    createRankedSection({
      key: "biggestMarketVolume",
      eyebrow: "Market heat",
      title: "Biggest Market Volume",
      items: topN(
        enriched,
        (a, b) =>
          Number(b.featuredMarket?.volume ?? -1) - Number(a.featuredMarket?.volume ?? -1),
        (person) => person.featuredMarket !== null
      ),
      stat: (person) => `${compactNumber.format(person.featuredMarket?.volume || 0)} volume`,
      market: (person) =>
        person.featuredMarket
          ? `${person.featuredMarket.uiTitle}: ${formatPercent(person.featuredMarket.probability)}`
          : "No linked market odds available",
    }),
  ];

  return [...computedSections, ...createEditorialSections(peopleByName)];
}

function buildFallbackPayload(errorMessage) {
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      people: 0,
      withAge: 0,
      withMarkets: 0,
    },
    source: "fallback",
    notice: errorMessage,
    sections: createEditorialSections(new Map()),
  };
}

async function buildFreshPayload() {
  const rawPeople = await fetchPeoplePages();
  const relevantPeople = rawPeople
    .filter((person) => person.photo_url)
    .filter(isFederalCongressPerson)
    .map(normalizePerson);

  const enriched = await Promise.all(relevantPeople.map(enrichWithMarkets));

  const payload = {
    generatedAt: new Date().toISOString(),
    totals: {
      people: enriched.length,
      withAge: enriched.filter((person) => person.age !== null).length,
      withMarkets: enriched.filter((person) => person.bestOdds !== null).length,
    },
    source: "live",
    sections: buildSections(enriched),
  };

  cachedPayload = payload;
  safeWriteSnapshot(payload);
  return payload;
}

async function buildPayload() {
  if (cachedPayload) {
    return cachedPayload;
  }

  const snapshot = readSnapshot();
  if (snapshot) {
    cachedPayload = snapshot;
    return snapshot;
  }

  try {
    return await buildFreshPayload();
  } catch (error) {
    const fallback = buildFallbackPayload(error.message || "fetch failed");
    cachedPayload = fallback;
    safeWriteSnapshot(fallback);
    return fallback;
  }
}

module.exports = {
  buildFallbackPayload,
  buildFreshPayload,
  buildPayload,
};