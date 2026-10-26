"""Pick simple Tatoeba example sentences for card words. Sentences come verbatim from the Tatoeba
weekly exports (CC BY 2.0 FR); this module only searches, scores and selects them."""
import bz2, re, unicodedata, sqlite3
from collections import Counter, defaultdict
TDIR = '/workspace/langdb/tatoeba'
L3 = {'fr': 'fra', 'ru': 'rus', 'nl': 'nld'}
MAX_TOK, IDEAL_TOK, TOP_FREQ = 12, 8, 1500

# form_of rows that are derivations, not inflections (подруга < друг, ручка < рука, учиться < учить)
DERIV = re.compile(r'equivalent of|diminutive|augmentative|reflexive of|endearing|pejorative|abbreviation|short for|nickname', re.I)
def inflection(desc): return not (desc and DERIV.search(desc))

def norm(lang, s):
    s = s.lower()
    if lang == 'ru':
        s = ''.join(c for c in unicodedata.normalize('NFD', s) if c not in '\u0301\u0300')
        s = unicodedata.normalize('NFC', s).replace('ё', 'е')
    return s
FR_ELIDE = {'l','d','j','m','t','s','n','c','qu','jusqu','lorsqu','puisqu','quoiqu'}
def tokens(lang, s):
    s = norm(lang, s)
    if lang != 'fr': return re.findall(r"[^\W\d_]+", s)
    out = []
    for w in re.findall(r"[^\W\d_]+(?:['’][^\W\d_]+)*", s):
        parts = re.split(r"['’]", w)
        # split elided clitics (l'homme -> l homme) but keep words like quelqu'un, aujourd'hui whole
        while len(parts) > 1 and parts[0] in FR_ELIDE: out.append(parts.pop(0))
        out.append("'".join(parts))
    return out

def read(fn):
    with bz2.open(f'{TDIR}/{fn}.tsv.bz2', 'rt', encoding='utf-8') as f:
        for line in f: yield line.rstrip('\n').split('\t')

class Examples:
    def __init__(self, lang, db: sqlite3.Connection, easy_sources):
        self.lang = lang; l3 = L3[lang]
        self.sent = {}; self.user = {}; self.links = {'es': defaultdict(list), 'en': defaultdict(list)}
        for r in read(f'{l3}_sentences_detailed'):
            self.sent[int(r[0])] = r[2]; self.user[int(r[0])] = r[3] if len(r) > 3 and r[3] != '\\N' else None
        need = set()
        for tl, t3 in (('es', 'spa'), ('en', 'eng')):
            for a, b in read(f'{l3}-{t3}_links'):
                self.links[tl][int(a)].append(int(b)); need.add(int(b))
        self.tr = {}
        for t3 in ('spa', 'eng'):
            for r in read(f'{t3}_sentences_detailed'):
                i = int(r[0])
                if i in need: self.tr[i] = r[2]
        # inverted index token -> sentence ids (only sentences short enough and with a translation)
        self.toks = {}; self.index = defaultdict(list); freq = Counter()
        for i, s in self.sent.items():
            t = tokens(lang, s); freq.update(t)
            if 3 <= len(t) <= MAX_TOK and (self.links['es'].get(i) or self.links['en'].get(i)):
                self.toks[i] = t
                for x in set(t): self.index[x].append(i)
        # "easy" vocabulary: forms of A1/A2 list words (from langdb) + most frequent Tatoeba tokens
        easy = {w for w, _ in freq.most_common(TOP_FREQ)}
        q = f"""SELECT DISTINCT l.lemma, l.lemma_id FROM cefr_levels c JOIN lemmas l ON l.lemma_id = c.lemma_id
                WHERE c.lang=? AND c.level IN ('A1','A2') AND c.source_id IN ({','.join('?'*len(easy_sources))})"""
        ids = []
        for lem, lid in db.execute(q, (lang, *easy_sources)):
            easy.update(tokens(lang, lem)); ids.append(lid)
        for (f,) in db.execute(f"SELECT form FROM forms WHERE lemma_id IN ({','.join(map(str, ids))})"):
            easy.update(tokens(lang, f))
        self.easy = easy
        # tokens that are also forms of A1/A2 words of a *different* POS (homographs like porte / porter)
        # token -> {(lemma, pos)} over A1/A2 words, to detect homographs (porte/porter, часы/час, est/être)
        self.owners = defaultdict(set)
        for lem, pos in db.execute(f"SELECT lemma, pos FROM lemmas WHERE lemma_id IN ({','.join(map(str, ids))})"):
            t = tokens(lang, lem)
            if len(t) == 1: self.owners[t[0]].add((norm(lang, lem), pos))
        part = defaultdict(set)
        for f, lw, pos, tags, d in db.execute(f"SELECT form, lemma_word, pos, tags, description FROM forms WHERE lemma_id IN ({','.join(map(str, ids))}) AND relation='form_of'"):
            t = tokens(lang, f)
            if len(t) == 1 and inflection(d):
                self.owners[t[0]].add((norm(lang, lw), pos))
                if lang == 'fr' and 'participle' in (tags or ''): part[t[0]].add((norm(lang, lw), pos))
        # French participle agreement: entrée/entrées -> entré -> entrer
        if part:
            rows = [(norm(lang, f), norm(lang, lw)) for f, lw in db.execute("SELECT form, lemma_word FROM forms WHERE lang=? AND relation='form_of'", (lang,)) if ' ' not in f]
            for _ in range(2):   # entré -> entrée -> entrées
                new = defaultdict(set)
                for f, lw in rows:
                    if lw in part: new[f] |= part[lw]
                for f, v in new.items(): part[f] |= v
            for f, v in part.items(): self.owners[f] |= v
        # every Wiktionary headword of the language: an inflected form that is itself a headword
        # (вина 'fault' vs вино, часы 'clock' vs час) is treated as ambiguous
        self.heads = {norm(lang, l) for (l,) in db.execute("SELECT DISTINCT lemma FROM lemmas WHERE lang=? AND source_id='enwikt'", (lang,))}
        self.db = db

    def surface_forms(self, word, pos, lemma_id):
        """Lemma + its inflected forms (same POS) from langdb's forms table."""
        forms = {word}
        for f, d in self.db.execute("SELECT form, description FROM forms WHERE (lemma_id=? OR (lang=? AND lemma_word=?)) AND pos=? AND relation='form_of'",
                                    (lemma_id, self.lang, word, pos)):
            if inflection(d): forms.add(f)
        # a bare lemma shared by several same-POS entries (e.g. есть 'eat' / есть 'there is') is ambiguous
        n_same = self.db.execute("SELECT count(*) FROM lemmas WHERE lang=? AND lemma=? AND pos=? AND source_id='enwikt'", (self.lang, word, pos)).fetchone()[0]
        out = []
        for f in forms:
            t = tuple(tokens(self.lang, f))
            if not t: continue
            if n_same > 1 and f == word: continue
            out.append(t)
        return set(out)

    def _match(self, toks, seqs, pos, word, sense_ok):
        """Return index of the first match of any form sequence, honouring homograph rules: a token that is
        also a form of another A1/A2 word only counts if a linked translation contains one of the card's
        own translations (e.g. 'Ouvrez la porte.' / 'Open the door.' for porte = door)."""
        for k in range(len(toks)):
            for seq in seqs:
                if tuple(toks[k:k + len(seq)]) != seq: continue
                if len(seq) > 1: return k
                if seq[0] != norm(self.lang, word) and seq[0] in self.heads: continue
                other = self.owners.get(seq[0], set()) - {(norm(self.lang, word), pos)}
                if not other or sense_ok: return k
        return None

    @staticmethod
    def _has(text, words):
        """Does a translation contain one of the card's translations (simple inflection tolerant)?"""
        if not text or not words: return False
        toks = re.findall(r"[^\W\d_]+", text.lower())
        joined = ' ' + ' '.join(toks) + ' '
        for w in words:
            wt = re.findall(r"[^\W\d_]+", w.lower())
            if wt[:1] == ['to'] and len(wt) > 1: wt = wt[1:]
            if not wt: continue
            if len(wt) > 1:
                if ' ' + ' '.join(wt) + ' ' in joined: return True
                continue
            w0 = wt[0]
            ok = {w0, w0 + 's', w0 + 'es', w0 + 'ed', w0 + 'd', w0 + 'ing'} | ({w0[:-1] + 'ing'} if w0.endswith('e') else set()) \
                 | ({w0[:-1] + 'ies'} if w0.endswith('y') else set())
            if ok & set(toks): return True
        return False

    def pick(self, word, pos, lemma_id, n=3, tr_es=(), tr_en=()):
        seqs = self.surface_forms(word, pos, lemma_id)
        cand = set()
        for seq in seqs: cand.update(self.index.get(seq[0], ()))
        scored = []
        for i in cand:
            t = self.toks[i]
            es = self._best_tr('es', i); en = self._best_tr('en', i)
            # sense check: every available side (es, en) must contain one of the card's translations
            sides = [self._has(x[0], tr) for x, tr in ((es, tr_es), (en, tr_en)) if x and tr]
            sense = bool(sides) and all(sides)
            k = self._match(t, seqs, pos, word, sense)
            if k is None: continue
            matched = set(range(k, k + 1))
            hard = sum(1 for j, x in enumerate(t) if j not in matched and x not in self.easy)
            both = 0 if (es and en) else 1
            scored.append(((hard, both, 0 if sense else 1, max(0, len(t) - IDEAL_TOK), len(t), i), i, es, en, hard))
        scored.sort()
        out, seen = [], set()
        for key, i, es, en, hard in scored:
            sig = ' '.join(tokens(self.lang, self.sent[i]))
            if sig in seen or (es and ('es', es[1]) in seen) or (en and ('en', en[1]) in seen): continue
            seen.add(sig)
            if es: seen.add(('es', es[1]))
            if en: seen.add(('en', en[1]))
            e = {'t': self.sent[i], 'id': i}
            if es: e['es'] = es
            if en: e['en'] = en
            if self.user.get(i): e['by'] = self.user[i]
            e['h'] = hard
            out.append(e)
            if len(out) >= n: break
        return out

    def _best_tr(self, tl, i):
        ids = [j for j in self.links[tl].get(i, ()) if j in self.tr]
        if not ids: return None
        j = min(ids, key=lambda j: (len(self.tr[j]), j))
        return [self.tr[j], j]
