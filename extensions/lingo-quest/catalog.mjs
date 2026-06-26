// catalog.mjs — LingoQuest course catalog (SDK-free data).
//
// Curated mini-courses for popular languages, each with a mascot, flag, accent
// color and a Duolingo-style unit → lesson → flashcard structure. pick_language
// turns one of these into a live course (assigning stable ids). Unknown
// languages get a friendly scaffold the agent can flesh out via add_unit.

// Compact builders so the data below stays readable.
const c = (front, back, emoji, pron) => ({ front, back, emoji, pron });
const L = (title, emoji, cards) => ({ title, emoji, cards });
const U = (title, emoji, lessons) => ({ title, emoji, lessons });

export const CATALOG = {
  es: {
    code: "es", name: "Spanish", flag: "🇪🇸", mascot: "🦊",
    mascotName: "Paco the Fox", accent: "#f4b740",
    blurb: "¡Vamos! Paco's packed churros, verbs and chaos.",
    cheer: "¡Excelente!",
    units: [
      U("First Words", "👋", [
        L("Greetings", "🙌", [
          c("hola", "hello", "👋", "OH-lah"),
          c("buenos días", "good morning", "☀️", "BWEH-nos DEE-as"),
          c("buenas noches", "good night", "🌙", "BWEH-nas NO-ches"),
          c("adiós", "goodbye", "👋", "ah-dee-OHS"),
        ]),
        L("Courtesy", "🤝", [
          c("gracias", "thank you", "🙏", "GRAH-see-as"),
          c("por favor", "please", "✨", "por fah-VOR"),
          c("de nada", "you're welcome", "😊", "deh NAH-da"),
          c("perdón", "sorry", "🫣", "per-DOHN"),
        ]),
      ]),
      U("Food & Café", "🍽️", [
        L("Food", "🍞", [
          c("pan", "bread", "🍞", "pahn"),
          c("queso", "cheese", "🧀", "KEH-so"),
          c("manzana", "apple", "🍎", "man-SAH-na"),
          c("pollo", "chicken", "🍗", "PO-yo"),
        ]),
        L("Drinks", "☕", [
          c("agua", "water", "💧", "AH-gwa"),
          c("café", "coffee", "☕", "kah-FEH"),
          c("leche", "milk", "🥛", "LEH-cheh"),
          c("vino", "wine", "🍷", "VEE-no"),
        ]),
      ]),
      U("Out & About", "🧭", [
        L("Numbers", "🔢", [
          c("uno", "one", "1️⃣", "OO-no"),
          c("dos", "two", "2️⃣", "dohs"),
          c("tres", "three", "3️⃣", "trehs"),
          c("cuatro", "four", "4️⃣", "KWAH-tro"),
        ]),
        L("Directions", "🧭", [
          c("izquierda", "left", "⬅️", "ees-kee-AIR-da"),
          c("derecha", "right", "➡️", "deh-REH-cha"),
          c("aquí", "here", "📍", "ah-KEE"),
          c("dónde", "where", "❓", "DON-deh"),
        ]),
      ]),
    ],
  },

  fr: {
    code: "fr", name: "French", flag: "🇫🇷", mascot: "🐸",
    mascotName: "Margot the Frog", accent: "#6ea8fe",
    blurb: "Bonjour! Margot hops between croissants and conjugations.",
    cheer: "Magnifique !",
    units: [
      U("First Words", "👋", [
        L("Greetings", "🙌", [
          c("bonjour", "hello", "👋", "bon-ZHOOR"),
          c("bonsoir", "good evening", "🌆", "bon-SWAHR"),
          c("salut", "hi", "😄", "sah-LOO"),
          c("au revoir", "goodbye", "👋", "oh ruh-VWAHR"),
        ]),
        L("Courtesy", "🤝", [
          c("merci", "thank you", "🙏", "mehr-SEE"),
          c("s'il vous plaît", "please", "✨", "seel voo PLEH"),
          c("de rien", "you're welcome", "😊", "duh ree-EN"),
          c("pardon", "sorry", "🫣", "par-DOHN"),
        ]),
      ]),
      U("Food & Café", "🍽️", [
        L("Food", "🍞", [
          c("pain", "bread", "🥖", "pan"),
          c("fromage", "cheese", "🧀", "froh-MAHZH"),
          c("pomme", "apple", "🍎", "pohm"),
          c("poulet", "chicken", "🍗", "poo-LEH"),
        ]),
        L("Drinks", "☕", [
          c("eau", "water", "💧", "oh"),
          c("café", "coffee", "☕", "kah-FEH"),
          c("lait", "milk", "🥛", "leh"),
          c("vin", "wine", "🍷", "van"),
        ]),
      ]),
      U("Out & About", "🧭", [
        L("Numbers", "🔢", [
          c("un", "one", "1️⃣", "uhn"),
          c("deux", "two", "2️⃣", "duh"),
          c("trois", "three", "3️⃣", "twah"),
          c("quatre", "four", "4️⃣", "KAH-truh"),
        ]),
        L("Directions", "🧭", [
          c("gauche", "left", "⬅️", "gohsh"),
          c("droite", "right", "➡️", "drwaht"),
          c("ici", "here", "📍", "ee-SEE"),
          c("où", "where", "❓", "oo"),
        ]),
      ]),
    ],
  },

  ja: {
    code: "ja", name: "Japanese", flag: "🇯🇵", mascot: "🐱",
    mascotName: "Tama the Cat", accent: "#ff7eb6",
    blurb: "こんにちは! Tama naps on the kana and dreams in sushi.",
    cheer: "すごい！",
    units: [
      U("First Words", "👋", [
        L("Greetings", "🙌", [
          c("こんにちは", "hello", "👋", "kon-nichi-wa"),
          c("おはよう", "good morning", "☀️", "o-ha-yoh"),
          c("こんばんは", "good evening", "🌆", "kon-ban-wa"),
          c("さようなら", "goodbye", "👋", "sa-yoh-na-ra"),
        ]),
        L("Courtesy", "🤝", [
          c("ありがとう", "thank you", "🙏", "a-ri-ga-toh"),
          c("おねがいします", "please", "✨", "o-ne-gai-shi-mas"),
          c("どういたしまして", "you're welcome", "😊", "doh-ita-shi-mashite"),
          c("ごめんなさい", "sorry", "🫣", "go-men-na-sai"),
        ]),
      ]),
      U("Food & Café", "🍽️", [
        L("Food", "🍞", [
          c("パン", "bread", "🍞", "pan"),
          c("ごはん", "rice", "🍚", "go-han"),
          c("りんご", "apple", "🍎", "rin-go"),
          c("さかな", "fish", "🐟", "sa-ka-na"),
        ]),
        L("Drinks", "☕", [
          c("みず", "water", "💧", "mi-zu"),
          c("コーヒー", "coffee", "☕", "koh-hee"),
          c("おちゃ", "tea", "🍵", "o-cha"),
          c("ぎゅうにゅう", "milk", "🥛", "gyoo-nyoo"),
        ]),
      ]),
      U("Out & About", "🧭", [
        L("Numbers", "🔢", [
          c("いち", "one", "1️⃣", "i-chi"),
          c("に", "two", "2️⃣", "ni"),
          c("さん", "three", "3️⃣", "san"),
          c("よん", "four", "4️⃣", "yon"),
        ]),
        L("Directions", "🧭", [
          c("ひだり", "left", "⬅️", "hi-da-ri"),
          c("みぎ", "right", "➡️", "mi-gi"),
          c("ここ", "here", "📍", "ko-ko"),
          c("どこ", "where", "❓", "do-ko"),
        ]),
      ]),
    ],
  },

  de: {
    code: "de", name: "German", flag: "🇩🇪", mascot: "🦅",
    mascotName: "Adler the Eagle", accent: "#f6c177",
    blurb: "Hallo! Adler soars over pretzels and very long nouns.",
    cheer: "Wunderbar!",
    units: [
      U("First Words", "👋", [
        L("Greetings", "🙌", [
          c("hallo", "hello", "👋", "HAH-loh"),
          c("guten Morgen", "good morning", "☀️", "GOO-ten MOR-gen"),
          c("guten Abend", "good evening", "🌆", "GOO-ten AH-bent"),
          c("tschüss", "bye", "👋", "chuess"),
        ]),
        L("Courtesy", "🤝", [
          c("danke", "thank you", "🙏", "DAHN-kuh"),
          c("bitte", "please", "✨", "BIT-tuh"),
          c("gern geschehen", "you're welcome", "😊", "gairn guh-SHEH-en"),
          c("Entschuldigung", "sorry", "🫣", "ent-SHOOL-di-goong"),
        ]),
      ]),
      U("Food & Café", "🍽️", [
        L("Food", "🍞", [
          c("Brot", "bread", "🍞", "broht"),
          c("Käse", "cheese", "🧀", "KAY-zuh"),
          c("Apfel", "apple", "🍎", "AHP-fel"),
          c("Hähnchen", "chicken", "🍗", "HEHN-chen"),
        ]),
        L("Drinks", "☕", [
          c("Wasser", "water", "💧", "VAH-ser"),
          c("Kaffee", "coffee", "☕", "KAH-fey"),
          c("Milch", "milk", "🥛", "milkh"),
          c("Bier", "beer", "🍺", "beer"),
        ]),
      ]),
      U("Out & About", "🧭", [
        L("Numbers", "🔢", [
          c("eins", "one", "1️⃣", "ines"),
          c("zwei", "two", "2️⃣", "tsvai"),
          c("drei", "three", "3️⃣", "drai"),
          c("vier", "four", "4️⃣", "feer"),
        ]),
        L("Directions", "🧭", [
          c("links", "left", "⬅️", "links"),
          c("rechts", "right", "➡️", "rekhts"),
          c("hier", "here", "📍", "heer"),
          c("wo", "where", "❓", "voh"),
        ]),
      ]),
    ],
  },

  it: {
    code: "it", name: "Italian", flag: "🇮🇹", mascot: "🐺",
    mascotName: "Lupo the Wolf", accent: "#85c46b",
    blurb: "Ciao! Lupo howls for pasta and rolls every R.",
    cheer: "Perfetto!",
    units: [
      U("First Words", "👋", [
        L("Greetings", "🙌", [
          c("ciao", "hello", "👋", "chow"),
          c("buongiorno", "good morning", "☀️", "bwon-JOR-no"),
          c("buonasera", "good evening", "🌆", "bwona-SEH-ra"),
          c("arrivederci", "goodbye", "👋", "ar-ree-veh-DAIR-chee"),
        ]),
        L("Courtesy", "🤝", [
          c("grazie", "thank you", "🙏", "GRAH-tsee-eh"),
          c("per favore", "please", "✨", "pair fah-VOH-reh"),
          c("prego", "you're welcome", "😊", "PREH-go"),
          c("scusa", "sorry", "🫣", "SKOO-za"),
        ]),
      ]),
      U("Food & Café", "🍽️", [
        L("Food", "🍞", [
          c("pane", "bread", "🍞", "PAH-neh"),
          c("formaggio", "cheese", "🧀", "for-MAH-jo"),
          c("mela", "apple", "🍎", "MEH-la"),
          c("pasta", "pasta", "🍝", "PAH-sta"),
        ]),
        L("Drinks", "☕", [
          c("acqua", "water", "💧", "AH-kwa"),
          c("caffè", "coffee", "☕", "kaf-FEH"),
          c("latte", "milk", "🥛", "LAH-teh"),
          c("vino", "wine", "🍷", "VEE-no"),
        ]),
      ]),
      U("Out & About", "🧭", [
        L("Numbers", "🔢", [
          c("uno", "one", "1️⃣", "OO-no"),
          c("due", "two", "2️⃣", "DOO-eh"),
          c("tre", "three", "3️⃣", "treh"),
          c("quattro", "four", "4️⃣", "KWAT-tro"),
        ]),
        L("Directions", "🧭", [
          c("sinistra", "left", "⬅️", "see-NEE-stra"),
          c("destra", "right", "➡️", "DEH-stra"),
          c("qui", "here", "📍", "kwee"),
          c("dove", "where", "❓", "DOH-veh"),
        ]),
      ]),
    ],
  },

  pt: {
    code: "pt", name: "Portuguese", flag: "🇧🇷", mascot: "🦜",
    mascotName: "Zé the Parrot", accent: "#3fb950",
    blurb: "Olá! Zé squawks samba between brigadeiros.",
    cheer: "Maravilhoso!",
    units: [
      U("First Words", "👋", [
        L("Greetings", "🙌", [
          c("olá", "hello", "👋", "oh-LAH"),
          c("bom dia", "good morning", "☀️", "bohn DEE-ah"),
          c("boa noite", "good night", "🌙", "BOH-ah NOY-cheh"),
          c("tchau", "bye", "👋", "chow"),
        ]),
        L("Courtesy", "🤝", [
          c("obrigado", "thank you", "🙏", "oh-bree-GAH-doo"),
          c("por favor", "please", "✨", "poor fah-VOR"),
          c("de nada", "you're welcome", "😊", "jee NAH-da"),
          c("desculpa", "sorry", "🫣", "dees-KOOL-pa"),
        ]),
      ]),
      U("Food & Café", "🍽️", [
        L("Food", "🍞", [
          c("pão", "bread", "🍞", "powng"),
          c("queijo", "cheese", "🧀", "KAY-zhoo"),
          c("maçã", "apple", "🍎", "ma-SANG"),
          c("frango", "chicken", "🍗", "FRAN-goo"),
        ]),
        L("Drinks", "☕", [
          c("água", "water", "💧", "AH-gwa"),
          c("café", "coffee", "☕", "ka-FEH"),
          c("leite", "milk", "🥛", "LAY-cheh"),
          c("suco", "juice", "🧃", "SOO-koo"),
        ]),
      ]),
      U("Out & About", "🧭", [
        L("Numbers", "🔢", [
          c("um", "one", "1️⃣", "oong"),
          c("dois", "two", "2️⃣", "doysh"),
          c("três", "three", "3️⃣", "trehs"),
          c("quatro", "four", "4️⃣", "KWAH-troo"),
        ]),
        L("Directions", "🧭", [
          c("esquerda", "left", "⬅️", "es-KER-da"),
          c("direita", "right", "➡️", "jee-RAY-ta"),
          c("aqui", "here", "📍", "ah-KEE"),
          c("onde", "where", "❓", "ON-jee"),
        ]),
      ]),
    ],
  },

  ko: {
    code: "ko", name: "Korean", flag: "🇰🇷", mascot: "🐯",
    mascotName: "Horangi the Tiger", accent: "#bd93f9",
    blurb: "안녕! Horangi prowls the hangul, fueled by kimchi.",
    cheer: "대박!",
    units: [
      U("First Words", "👋", [
        L("Greetings", "🙌", [
          c("안녕하세요", "hello", "👋", "an-nyeong-ha-se-yo"),
          c("좋은 아침", "good morning", "☀️", "jo-eun a-chim"),
          c("안녕히 주무세요", "good night", "🌙", "an-nyeong-hi ju-mu-se-yo"),
          c("안녕", "bye", "👋", "an-nyeong"),
        ]),
        L("Courtesy", "🤝", [
          c("감사합니다", "thank you", "🙏", "gam-sa-ham-ni-da"),
          c("주세요", "please", "✨", "ju-se-yo"),
          c("천만에요", "you're welcome", "😊", "cheon-man-e-yo"),
          c("죄송합니다", "sorry", "🫣", "joe-song-ham-ni-da"),
        ]),
      ]),
      U("Food & Café", "🍽️", [
        L("Food", "🍞", [
          c("빵", "bread", "🍞", "ppang"),
          c("밥", "rice", "🍚", "bap"),
          c("사과", "apple", "🍎", "sa-gwa"),
          c("김치", "kimchi", "🥬", "gim-chi"),
        ]),
        L("Drinks", "☕", [
          c("물", "water", "💧", "mul"),
          c("커피", "coffee", "☕", "keo-pi"),
          c("차", "tea", "🍵", "cha"),
          c("우유", "milk", "🥛", "u-yu"),
        ]),
      ]),
      U("Out & About", "🧭", [
        L("Numbers", "🔢", [
          c("하나", "one", "1️⃣", "ha-na"),
          c("둘", "two", "2️⃣", "dul"),
          c("셋", "three", "3️⃣", "set"),
          c("넷", "four", "4️⃣", "net"),
        ]),
        L("Directions", "🧭", [
          c("왼쪽", "left", "⬅️", "oen-jjok"),
          c("오른쪽", "right", "➡️", "o-reun-jjok"),
          c("여기", "here", "📍", "yeo-gi"),
          c("어디", "where", "❓", "eo-di"),
        ]),
      ]),
    ],
  },
};

// Friendly fallbacks for languages not in the curated catalog.
const SCAFFOLD_MASCOTS = [
  ["🦄", "Sparkle the Unicorn"],
  ["🐙", "Otto the Octopus"],
  ["🦉", "Ollie the Owl"],
  ["🐲", "Drako the Dragon"],
  ["🦦", "Sora the Otter"],
  ["🐨", "Kiki the Koala"],
  ["🐝", "Buzz the Bee"],
  ["🦔", "Pip the Hedgehog"],
];
const SCAFFOLD_ACCENTS = ["#58a6ff", "#f778ba", "#3fb950", "#f4b740", "#bd93f9", "#ff7eb6"];

// Normalize a free-text language into a catalog key when possible.
const ALIASES = {
  spanish: "es", español: "es", espanol: "es", castellano: "es",
  french: "fr", français: "fr", francais: "fr",
  japanese: "ja", "日本語": "ja", nihongo: "ja",
  german: "de", deutsch: "de",
  italian: "it", italiano: "it",
  portuguese: "pt", português: "pt", portugues: "pt", brazilian: "pt",
  korean: "ko", "한국어": "ko", hangul: "ko",
};

export function resolveLanguageKey(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  if (CATALOG[key]) return key;
  if (ALIASES[key]) return ALIASES[key];
  return null;
}

export function catalogLanguages() {
  return Object.values(CATALOG).map((c) => ({
    code: c.code, name: c.name, flag: c.flag, mascot: c.mascot,
    mascotName: c.mascotName, accent: c.accent, blurb: c.blurb,
  }));
}

// Build a live course object (with stable ids) for the given language input.
// Returns a course even for unknown languages (a scaffold the agent can fill).
export function buildCourse(rawLanguage) {
  const key = resolveLanguageKey(rawLanguage);
  if (key) return instantiate(CATALOG[key]);

  // Unknown language → scaffold.
  const name = titleCase(String(rawLanguage ?? "").trim()) || "Your Language";
  const code = "custom-" + slug(name);
  const [mascot, mascotName] = pick(SCAFFOLD_MASCOTS, name);
  return {
    code, name, flag: "🌍", mascot, mascotName,
    accent: pick(SCAFFOLD_ACCENTS, name),
    blurb: `${mascotName} is ready — ask the agent to add lessons for ${name}!`,
    cheer: "Great job!",
    custom: true,
    units: [
      {
        id: `${code}-u1`, title: "First Words", emoji: "👋",
        lessons: [
          {
            id: `${code}-u1-l1`, title: "Getting Started", emoji: "🌱", done: false,
            cards: [
              { front: "👋", back: "Say: \"add a lesson for " + name + "\" to the agent", emoji: "🤖", pron: "" },
            ],
          },
        ],
      },
    ],
  };
}

function instantiate(src) {
  return {
    code: src.code, name: src.name, flag: src.flag, mascot: src.mascot,
    mascotName: src.mascotName, accent: src.accent, blurb: src.blurb,
    cheer: src.cheer, custom: false,
    units: src.units.map((u, ui) => ({
      id: `${src.code}-u${ui + 1}`,
      title: u.title, emoji: u.emoji,
      lessons: u.lessons.map((l, li) => ({
        id: `${src.code}-u${ui + 1}-l${li + 1}`,
        title: l.title, emoji: l.emoji, done: false,
        cards: l.cards.map((card) => ({ ...card })),
      })),
    })),
  };
}

function titleCase(s) {
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase());
}
function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lang";
}
function pick(arr, seed) {
  let h = 0;
  for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return arr[h % arr.length];
}
