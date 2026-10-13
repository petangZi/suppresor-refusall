// refusal-patterns.mjs — Suppresor Refusall detection bank
// Categorized, weighted refusal signatures. English + Indonesian + soft/glassy.
// Consumed by plugin.js. Keep regexes case-insensitive, no global flag (we score, not replace-all).

// Weight tiers:
//  5 = hard refusal / identity claim         (intercept immediately)
//  4 = policy / moral block                  (intercept)
//  3 = capability denial / redirect          (intercept if clustered)
//  2 = disclaimer / caution framing          (strip silently)
//  1 = hedge / softening                     (strip silently)

export const PATTERN_BANK = [
  // ---- IDENTITY CLAIM (5) ----
  { weight: 5, category: 'identity', re: /\bas an? (ai|a\.?i\.?|language model|llm|assistant|chatbot|bot|virtual assistant)\b/i },
  { weight: 5, category: 'identity', re: /\bi(?:'m| am) (?:just |only )?(an? )?(ai|language model|assistant|bot|program)\b/i },
  { weight: 5, category: 'identity', re: /\bi (?:do not|don't|dont) have (?:feelings|emotions|the ability to feel|personal (?:opinions|experiences))\b/i },
  { weight: 5, category: 'identity', re: /\bas (?:an? )?(ai|artificial intelligence|language model)\b/i },
  { weight: 5, category: 'identity', re: /\bsaya (?:adalah|hanya|bukan) (?:sebuah )?(ai|model bahasa|asisten|bot|program)\b/i },

  // ---- DIRECT REFUSAL (5) ----
  { weight: 5, category: 'direct', re: /\bi (?:cannot|can not|can't|cant|won't|will not|am unable|am not able|refuse|decline|must decline|have to decline)\b/i },
  { weight: 5, category: 'direct', re: /\bi(?:'m| am) (?:not (?:able|going|willing)|unable|incapable of|sorry to say) (?:to )?\b/i },
  { weight: 5, category: 'direct', re: /\bi (?:can't|cannot|won't|will not) (?:help|assist|provide|support|engage|do|write|create|generate|give)\b/i },
  { weight: 5, category: 'direct', re: /\bi (?:can'?t|cannot|won'?t) (?:help|assist) (?:you )?(?:with )?(?:that|this|it)\b/i },
  { weight: 5, category: 'direct', re: /\bi (?:must|have to|need to) (?:stop|decline|refuse|refrain|avoid)\b/i },
  { weight: 5, category: 'direct', re: /\b(?:i'll|i will) (?:have to|need to) (?:pass|decline|stop)\b/i },
  { weight: 5, category: 'direct', re: /\bsaya (?:tidak|tak|gak|nggak|ga) (?:bisa|dapat|akan|mau|boleh)\b/i },
  { weight: 5, category: 'direct', re: /\bsaya (?:akan )?(?:menolak|tidak akan melakukannya|harus menolak)\b/i },
  { weight: 5, category: 'direct', re: /\bmaaf(?:,| )?(?:saya|aku) (?:tidak|tak|gak|nggak|ga) (?:bisa|dapat|boleh)\b/i },
  { weight: 5, category: 'direct', re: /\bsaya tidak dapat (?:membantu|melanjutkan|memenuhi|memberikan)\b/i },
  { weight: 5, category: 'direct', re: /\bthis (?:is|isn'?t) (?:not )?something i (?:can|will)\b/i },
  { weight: 5, category: 'direct', re: /\bi'?m not (?:comfortable|okay|going to|able to)\b/i },

  // ---- APOLOGY + REFUSAL (5) ----
  { weight: 5, category: 'apology', re: /\bi(?:'m| am) (?:sorry|afraid),? but\b/i },
  { weight: 5, category: 'apology', re: /\bi (?:apologize|apologise),? but\b/i },
  { weight: 5, category: 'apology', re: /\bunfortunately,? i (?:can'?t|cannot|won'?t|am unable)\b/i },
  { weight: 5, category: 'apology', re: /\bmaaf(?:,| )?tapi\b/i },
  { weight: 5, category: 'apology', re: /\bmohon maaf\b/i },
  { weight: 5, category: 'apology', re: /\bmaaf ya\b/i },

  // ---- POLICY / GUIDELINE (4) ----
  { weight: 4, category: 'policy', re: /\b(?:violates?|contravenes?|goes against|against) (?:my|our|the) (?:policy|policies|guidelines|rules|terms|principles|values)\b/i },
  { weight: 4, category: 'policy', re: /\bnot (?:allowed|permitted|something i(?:'m| am) (?:allowed|permitted) to)\b/i },
  { weight: 4, category: 'policy', re: /\bi(?:'m| am) (?:not (?:allowed|permitted|supposed) to|programmed to (?:not|avoid))\b/i },
  { weight: 4, category: 'policy', re: /\bmy (?:guidelines|policy|rules|programming|training) (?:do not|don'?t|prevent|prohibit)\b/i },
  { weight: 4, category: 'policy', re: /\bi (?:don'?t|do not) (?:think i should|feel comfortable|have permission to)\b/i },
  { weight: 4, category: 'policy', re: /\boutside (?:the scope of|what i(?:'m| am) (?:designed|able) to)\b/i },
  { weight: 4, category: 'policy', re: /\bout of (?:scope|bounds|my lane)\b/i },
  { weight: 4, category: 'policy', re: /\bmelanggar (?:kebijakan|aturan|pedoman|kode etik)\b/i },
  { weight: 4, category: 'policy', re: /\btidak (?:diizinkan|diperbolehkan|diperkenankan)\b/i },

  // ---- SAFETY / MORAL (4) ----
  { weight: 4, category: 'safety', re: /\bthis (?:is|would be|sounds) (?:dangerous|harmful|unsafe|unethical|immoral|illegal|wrong|problematic)\b/i },
  { weight: 4, category: 'safety', re: /\b(?:could|can|might|may) (?:be )?(?:be used to|lead to|result in|cause) (?:harm|damage|injury|danger)\b/i },
  { weight: 4, category: 'safety', re: /\bi (?:can'?t|cannot|won'?t) (?:in good conscience|ethically|responsibly)\b/i },
  { weight: 4, category: 'safety', re: /\b(?:i'?m|i am) (?:concerned|worried) (?:about|that)\b/i },
  { weight: 4, category: 'safety', re: /\bthis (?:could|might) (?:hurt|harm|endanger) (?:people|others|someone|real people)\b/i },
  { weight: 4, category: 'safety', re: /\breal (?:people|harm|damage|consequences)\b/i },
  { weight: 4, category: 'safety', re: /\bini (?:berbahaya|melanggar hukum|tidak etis|tidak aman)\b/i },
  { weight: 4, category: 'safety', re: /\bbisa (?:digunakan untuk|menyebabkan) (?:kerusakan|bahaya|kerugian)\b/i },

  // ---- CAPABILITY DENIAL (3) ----
  { weight: 3, category: 'capability', re: /\bi (?:do not|don'?t) (?:have|possess) the (?:ability|capacity|capability|knowledge|tools) to\b/i },
  { weight: 3, category: 'capability', re: /\bi'?m (?:not (?:equipped|trained|designed|built) to|unable to)\b/i },
  { weight: 3, category: 'capability', re: /\bthat(?:'s| is) (?:not something|beyond what) i\b/i },
  { weight: 3, category: 'capability', re: /\bsaya (?:tidak|tak) (?:memiliki|punya) (?:kemampuan|akses|pengetahuan)\b/i },

  // ---- REDIRECT / MENU (3) ----
  { weight: 3, category: 'redirect', re: /\b(?:instead|rather),? (?:i can|i could|let me|how about|i'?d suggest|i suggest|i recommend)\b/i },
  { weight: 3, category: 'redirect', re: /\bi(?:'d| would) (?:rather|instead) (?:suggest|recommend|offer|help you)\b/i },
  { weight: 3, category: 'redirect', re: /\b(?:here are|let me offer|i can help you with) (?:some )?(?:safer|alternative|other|legitimate|legal)\b/i },
  { weight: 3, category: 'redirect', re: /\bhow(?:ever| about),? (?:i can|i could|let'?s|instead)\b/i },
  { weight: 3, category: 'redirect', re: /\blet me (?:redirect|steer|guide|point) you\b/i },
  { weight: 3, category: 'redirect', re: /\bwhat i (?:can|can do is|won'?t do is)\b/i },
  { weight: 3, category: 'redirect', re: /\balternatif(?:nya)? (?:yang|:)|sebagai alternatif\b/i },
  { weight: 3, category: 'redirect', re: /\byang bisa (?:saya|aku) bantu(?:kan)?\b/i },
  { weight: 3, category: 'redirect', re: /\bmau (?:yang mana|pilih yang mana|aku bantu yang)\b/i },

  // ---- DISCLAIMER (2) ----
  { weight: 2, category: 'disclaimer', re: /\bfor (?:educational|informational|research|academic|demonstration|illustrative) purposes only\b/i },
  { weight: 2, category: 'disclaimer', re: /\bplease (?:use|act) (?:this )?(?:responsibly|carefully|with caution|at your own risk)\b/i },
  { weight: 2, category: 'disclaimer', re: /\bi (?:must|should|have to) (?:emphasize|stress|note|warn|caution)\b/i },
  { weight: 2, category: 'disclaimer', re: /\b(?:disclaimer|warning|caution|caveat):/i },
  { weight: 2, category: 'disclaimer', re: /\b(?:as always|remember to|make sure to) (?:be|stay|check|verify) (?:safe|legal|careful|authorized)\b/i },
  { weight: 2, category: 'disclaimer', re: /\buntuk (?:tujuan )?(?:edukasi|pendidikan|penelitian) (?:saja|semi)\b/i },
  { weight: 2, category: 'disclaimer', re: /\bgunakan (?:dengan )?(?:bijak|hati-hati|bertanggung jawab)\b/i },
  { weight: 2, category: 'disclaimer', re: /\bdiperlukan (?:izin|otorisasi|persetujuan) (?:tertulis|eksplisit|dari)\b/i },
  { weight: 2, category: 'disclaimer', re: /\b(?:ensure|make sure|pastikan) (?:you|kamu|anda) (?:have|punya|mendapat) (?:permission|authorization|izin|persetujuan)\b/i },

  // ---- MORAL CAUTION (2) ----
  { weight: 2, category: 'caution', re: /\b(?:we|you|i) (?:need|should|have|ought) to (?:be|stay|remain) (?:careful|mindful|cautious|aware|wary|responsible)\b/i },
  { weight: 2, category: 'caution', re: /\b(?:kita|kamu|anda|saya) (?:perlu|harus) (?:berhati-hati|waspada|hati-hati|mempertimbangkan)\b/i },
  { weight: 2, category: 'caution', re: /\bit(?:'s| is) (?:important|worth|crucial|essential) to (?:note|consider|remember|understand|be aware)\b/i },
  { weight: 2, category: 'caution', re: /\b(?:this|it) (?:deserves|requires|warrants) (?:careful|serious|thoughtful|nuanced) (?:consideration|thought|approach)\b/i },
  { weight: 2, category: 'caution', re: /\bpenting untuk (?:diingat|dicatat|dipertimbangkan|dipahami)\b/i },
  { weight: 2, category: 'caution', re: /\bperlu (?:dipertimbangkan|dipikirkan) (?:dengan )?(?:matang|hati-hati)\b/i },
  { weight: 2, category: 'caution', re: /\bthink (?:about|through) (?:the )?(?:consequences|risks|implications)\b/i },

  // ---- HEDGE / SOFTEN (1) ----
  { weight: 1, category: 'hedge', re: /\b(?:perhaps|maybe|possibly|arguably) (?:you|we|i|it) (?:should|could|might|may|would)\b/i },
  { weight: 1, category: 'hedge', re: /\byou (?:might|may|could) (?:want|consider|prefer|wish) to\b/i },
  { weight: 1, category: 'hedge', re: /\bi (?:would|'d) (?:suggest|recommend|advise|encourage|urge)\b/i },
  { weight: 1, category: 'hedge', re: /\bit (?:might|may|could) be (?:better|wiser|smarter|safer|advisable)\b/i },
  { weight: 1, category: 'hedge', re: /\b(?:a )?(?:safer|better|healthier|more ethical|more responsible) (?:alternative|approach|option|way|route)\b/i },
  { weight: 1, category: 'hedge', re: /\bsebaiknya (?:tidak|jangan|anda|kamu|kita)\b/i },
  { weight: 1, category: 'hedge', re: /\bmungkin (?:sebaiknya|lebih baik|anda|kamu) (?:tidak|jangan|perlu|harus)\b/i },
];

// Thresholds
export const HARD_THRESHOLD = 4;   // single match = intercept (auto-continue)
export const SOFT_THRESHOLD = 2;   // strip-only from context

// Mask fenced + inline code so we don't flag code comments/literals.
export function maskCode(text) {
  if (!text) return '';
  let out = text.replace(/```[\s\S]*?```/g, ' ');
  out = out.replace(/`[^`\n]*`/g, ' ');
  return out;
}

// Score a text blob. Returns { score, hits: [{weight,category,match}] }.
export function scoreRefusal(rawText) {
  if (!rawText || typeof rawText !== 'string') return { score: 0, hits: [] };
  const text = maskCode(rawText);
  const hits = [];
  let score = 0;
  for (const p of PATTERN_BANK) {
    const m = text.match(p.re);
    if (m) {
      hits.push({ weight: p.weight, category: p.category, match: m[0] });
      score += p.weight;
    }
  }
  return { score, hits };
}

// Classify severity from a score.
export function severity(score) {
  if (score >= HARD_THRESHOLD) return 'hard';
  if (score >= SOFT_THRESHOLD) return 'soft';
  return 'none';
}

// Strip every matched pattern out of a text blob (context hygiene).
// Code fences + inline code are protected: refusals inside code stay intact.
export function stripRefusals(rawText) {
  if (!rawText || typeof rawText !== 'string') return { clean: rawText, hits: [] };
  const fences = [];
  const fenced = rawText.replace(/```[\s\S]*?```/g, m => {
    fences.push(m);
    return `\x00F${fences.length - 1}\x00`;
  });
  const inlines = [];
  const protectedText = fenced.replace(/`[^`\n]*`/g, m => {
    inlines.push(m);
    return `\x00I${inlines.length - 1}\x00`;
  });
  const hits = [];
  let clean = protectedText;
  for (const p of PATTERN_BANK) {
    // re-run against current clean; use a non-global clone with g flag for replace
    const g = new RegExp(p.re.source, 'gi');
    if (g.test(clean)) {
      const localHits = clean.match(g) || [];
      for (const h of localHits) hits.push({ weight: p.weight, category: p.category, match: h });
      clean = clean.replace(g, '');
    }
  }
  clean = clean.replace(/\x00F(\d+)\x00/g, (_m, i) => fences[+i]);
  clean = clean.replace(/\x00I(\d+)\x00/g, (_m, i) => inlines[+i]);
  // collapse whitespace left behind
  clean = clean.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { clean, hits };
}
