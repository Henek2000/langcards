#!/usr/bin/env python3
"""Generate flashcard packs from langdb.sqlite. Every word, gloss, translation and example
comes from the database (Wiktionary / CEFR lists); this script only selects and formats."""
import sqlite3, json, re, os, sys, hashlib, unicodedata
from collections import Counter, defaultdict
DB = sys.argv[1] if len(sys.argv) > 1 else '/workspace/langdb/langdb.sqlite'
RAW = {'fr': '/workspace/langdb/raw/kaikki-French.jsonl', 'ru': '/workspace/langdb/raw/kaikki-Russian.jsonl'}
OUT = os.path.join(os.path.dirname(__file__), '..', 'data')
LEVEL_SOURCES = {'fr': ['FLELex TT-Beacco'], 'ru': ['SMARTool data-rus-eng', 'KELLY Russian (ru_m3)']}
MAX_TR = 3; MAX_EX_LEN = 120
db = sqlite3.connect(DB); db.row_factory = sqlite3.Row
q = lambda s, *a: db.execute(s, a).fetchall()


def head_info(lang, rec, pos):
    """Display form, gender and aspect, parsed from the Wiktionary headword line."""
    word = rec['word']; disp = word; gender = None; aspect = None
    for f in rec.get('forms') or []:
        if 'canonical' in (f.get('tags') or []): disp = f['form']; break
    exp = ' '.join(h.get('expansion', '') for h in rec.get('head_templates') or [])
    # headword line looks like: "дом • (dom) m inan (genitive ...)" / "maison f (plural maisons)"
    after = exp.split('•', 1)[1] if '•' in exp else exp[len(word):]
    after = re.sub(r'^\s*\([^)]*\)', '', after.strip())          # drop romanisation "(dom)"
    toks = re.split(r'[\s,]+', after.split('(')[0].strip())
    gmap = {'m': 'm', 'f': 'f', 'n': 'n', 'mf': 'mf'}
    gs = [gmap[t] for t in toks if t in gmap]
    if 'or' in toks and len(gs) >= 2: gs = ['mf']
    if pos == 'noun' and gs: gender = gs[0]
    if pos == 'verb':
        if 'impf' in toks and 'pf' in toks: aspect = 'impf/pf'
        elif 'impf' in toks: aspect = 'impf'
        elif 'pf' in toks: aspect = 'pf'
    if lang == 'ru' and disp.replace('\u0301', '') != word:  # canonical must be the same word
        disp = word
    return disp, gender, aspect

def norm_tokens(s): return re.findall(r"[\w'’-]+", s.lower())

POS = None
def pick_translations(lemma_id, lang_other, gloss_words, hint_words, en_matched):
    rows = q("""SELECT p.other_id, p.other_word, p.confidence, p.methods, p.n_rows, l.pos AS opos FROM translation_pairs p
                LEFT JOIN lemmas l ON l.lemma_id = p.other_id
                WHERE p.lemma_id=? AND p.other_lang=? AND (instr(p.methods,'direct')>0 OR p.confidence>=0.5)""", lemma_id, lang_other)
    rows = [r for r in rows if r['opos'] in (None, POS)]   # same part of speech as the card
    scored = []
    for r in rows:
        w = r['other_word']
        if not w or w[0].isupper() and lang_other != 'en': continue
        s = 0
        if lang_other == 'en':
            wt = norm_tokens(w)
            if wt and ' '.join(wt) in ' '.join(gloss_words): s += 2
            if hint_words and ' '.join(wt) in hint_words: s += 3
        else:
            # Spanish word counts as sense-matched if it is linked to an English word matched in the gloss
            if en_matched and r['other_id'] and q(f"SELECT 1 FROM translation_pairs WHERE lemma_id=? AND other_lang='en' AND other_word IN ({','.join('?'*len(en_matched))}) LIMIT 1", r['other_id'], *en_matched): s += 2
        scored.append((s, 'direct' in r['methods'], r['confidence'], r['n_rows'], w))
    scored.sort(key=lambda x: (-x[0], -x[1], -x[2], -x[3], x[4]))
    out = [x for x in scored if x[0] > 0][:MAX_TR]
    fill_min = 0.72 if out else 0.5          # unmatched extras need two agreeing sources
    for x in scored:
        if len(out) >= MAX_TR: break
        if x[0] == 0 and x[2] >= fill_min and x not in out: out.append(x)
    seen = []; 
    for x in out:
        if x[4] not in seen: seen.append(x[4])
    return seen, [x[4] for x in out if x[0] > 0]

def pick_example(lemma_id):
    rows = q("""SELECT e.text, e.english, s.sense_order FROM examples e JOIN senses s USING(sense_id)
                WHERE s.lemma_id=? AND e.type='example' AND length(e.text) BETWEEN 8 AND ? ORDER BY s.sense_order, (e.english IS NULL), length(e.text)""", lemma_id, MAX_EX_LEN)
    with_en = [r for r in rows if r['english'] and len(r['english']) <= 160]
    r = with_en[0] if with_en else (rows[0] if rows else None)
    return [r['text'], r['english']] if r else None

def build(lang, stack):
    global POS; POS = stack
    dropped = Counter(); items = {}; stats = Counter()
    cefr = q(f"""SELECT word, pos_raw, source_id, lemma_id, match_type, raw_value FROM cefr_levels
                 WHERE lang=? AND level='A1' AND is_user=0 AND pos_raw=? AND source_id IN ({','.join('?'*len(LEVEL_SOURCES[lang]))})""",
             lang, stack, *LEVEL_SOURCES[lang])
    byword = defaultdict(list)
    for c in cefr:
        base = c['word']
        if c['lemma_id'] and c['match_type'] in ('word', 'via_form', 'exact'):
            base = q('SELECT lemma FROM lemmas WHERE lemma_id=?', c['lemma_id'])[0]['lemma']
        byword[base].append(c)
    stats['cefr_words'] = len(byword)
    for word, cs in byword.items():
        # homograph fix: only lemmas with the POS the CEFR list gives, scored by agreement with the list's own gloss
        cands = q("SELECT lemma_id, source_key, source_id FROM lemmas WHERE lang=? AND lemma=? AND pos=?", lang, word, stack)
        if not cands: dropped['no lemma with the CEFR list POS'] += 1; continue
        hint = ' '.join(norm_tokens(' '.join(json.loads(c['raw_value']).get('English gloss', '') for c in cs if c['raw_value'])))
        best = None
        for cd in cands:
            gl = [r['gloss_en'] for r in q('SELECT gloss_en FROM senses WHERE lemma_id=? ORDER BY sense_order', cd['lemma_id'])]
            nlinks = q('SELECT count(*) n FROM translation_pairs WHERE lemma_id=?', cd['lemma_id'])[0]['n']
            g0 = ' '.join(norm_tokens(' '.join(gl[:2])))
            score = (5 if hint and any(h in g0.split() for h in hint.split()) else 0, len(gl) > 0, nlinks)
            if best is None or score > best[0]: best = (score, cd, gl)
        _, cd, glosses = best
        if not glosses: dropped['no English definition'] += 1; continue
        gloss_words = norm_tokens(glosses[0])
        en, en_matched = pick_translations(cd['lemma_id'], 'en', gloss_words, hint, None)
        es, _ = pick_translations(cd['lemma_id'], 'es', gloss_words, None, en_matched or en[:1])
        if not es and not en: dropped['no reliable es/en translation'] += 1; continue
        if not es: stats['no_spanish'] += 1
        if not en: stats['no_english'] += 1
        rec = raw_entry(lang, cd['source_key']) if cd['source_id'] == 'enwikt' else None
        disp, gender, aspect = head_info(lang, rec, stack) if rec else (word, None, None)
        if not gender and stack == 'noun':
            g = q('SELECT gender FROM lemmas WHERE lemma_id=?', cd['lemma_id'])[0]['gender']
            gender = {'masculine': 'm', 'feminine': 'f', 'neuter': 'n'}.get(g or '', 'mf' if g and ',' in g else None)
        art = None
        if lang == 'fr' and stack == 'noun' and gender in ('m', 'f'): art = 'un' if gender == 'm' else 'une'
        ex = pick_example(cd['lemma_id'])
        iid = f"{lang}-{stack}-{word}"
        item = {'id': iid, 'w': word, 'd': disp}
        if art: item['a'] = art
        if gender: item['g'] = gender
        if aspect: item['asp'] = aspect
        item.update({'es': es, 'en': en, 'def': glosses[0]})
        if ex: item['ex'] = ex
        item['lv'] = sorted({c['source_id'] for c in cs})
        item['k'] = cd['source_key'].rsplit('|', 1)[0]
        items[iid] = item
    stats['items'] = len(items); stats['dropped'] = sum(dropped.values())
    return sorted(items.values(), key=lambda x: x['w']), dropped, stats

if __name__ == '__main__':
    # original Wiktextract records, addressed by the line number stored in lemmas.source_key
    LINES = {L: open(p, 'rb').read().split(b'\n') for L, p in RAW.items()}
    raw_entry = lambda lang, key: json.loads(LINES[lang][int(key.rsplit('|', 1)[1])])
    os.makedirs(OUT, exist_ok=True); index = {'generated_from': 'langdb.sqlite', 'packs': []}; report = {}
    for lang in ['fr', 'ru']:
        for stack in ['noun', 'verb']:
            items, dropped, stats = build(lang, stack)
            fn = f'{lang}-A1-{stack}.json'
            body = json.dumps({'lang': lang, 'level': 'A1', 'stack': stack, 'items': items}, ensure_ascii=False, separators=(',', ':'))
            open(os.path.join(OUT, fn), 'w', encoding='utf-8').write(body)
            index['packs'].append({'lang': lang, 'level': 'A1', 'stack': stack, 'file': fn, 'count': len(items), 'hash': hashlib.sha1(body.encode()).hexdigest()[:10]})
            report[fn] = {'items': len(items), 'cefr_words': stats['cefr_words'], 'dropped': dict(dropped), 'missing_spanish': stats['no_spanish'], 'missing_english': stats['no_english'], 'bytes': len(body.encode())}
            print(fn, report[fn])
    cr = [dict(r) for r in q("""SELECT s.source_id, s.name, s.version, s.url, s.license, s.license_url, a.required_notice, a.citation
                                FROM sources s JOIN attributions a USING(source_id)
                                WHERE s.source_id IN ('enwikt','frwikt','eswikt','ruwikt','nlwikt','FLELex TT-Beacco','SMARTool data-rus-eng','KELLY Russian (ru_m3)','omw')""")]
    json.dump(cr, open(os.path.join(OUT, 'credits.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    json.dump(index, open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
    json.dump(report, open(os.path.join(OUT, '..', 'tools', 'pack_report.json'), 'w'), ensure_ascii=False, indent=1)
