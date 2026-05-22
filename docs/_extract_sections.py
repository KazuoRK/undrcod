"""Extrai todos os componentes do CSS Inspector do Cursor pro nosso doc."""
import re
import os

SRC = 'C:/Users/taked/AppData/Local/Programs/cursor/resources/app/out/vs/workbench/workbench.desktop.main.js'
OUT_DIR = 'C:/Users/taked/Desktop/akai-code/docs/cursor-sections'
os.makedirs(OUT_DIR, exist_ok=True)

print('reading bundle...')
F = open(SRC, encoding='utf-8', errors='ignore').read()
print(f'  loaded {len(F):,} chars')


def balance(text, after_open_brace):
    """Acha o fechamento balanceado de { que JÁ ABRIU. `after_open_brace`
    aponta pro byte logo após o `{` de abertura. depth começa em 1."""
    depth = 1
    i = after_open_brace
    in_str = None
    while i < len(text):
        ch = text[i]
        if in_str:
            if ch == '\\':
                i += 2
                continue
            if ch == in_str:
                in_str = None
        else:
            if ch in ('"', "'", '`'):
                in_str = ch
            elif ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    return i + 1
        i += 1
    return -1


def extract_function(name):
    """Extrai uma função pelo nome (ex: 'XG0')."""
    m = re.search(rf'function {re.escape(name)}\(n\)\{{', F)
    if not m:
        return None
    end = balance(F, m.end())
    if end < 0:
        return None
    return F[m.start():end]


def extract_template(prefix):
    """Extrai template `st('<HTML...')` ou `st("<HTML...")` que precede a função."""
    for quote in ("'", '"'):
        m = re.search(rf'{re.escape(prefix)}=st\({re.escape(quote)}', F)
        if not m:
            continue
        start = m.end()
        i = start
        while i < len(F):
            if F[i] == quote and F[i-1] != '\\':
                return F[m.start():i+1]
            i += 1
    return None


# Componentes conhecidos do CSS Inspector (mapeamento minified → semântico)
COMPONENTS = [
    # (nome_funcao, label, descricao)
    ('XG0', 'PositionSection', 'X/Y/Z + rotation + flip buttons'),
    ('YG0', 'LayoutSection', 'Flow/Block/Flex/Grid + W/H + padding/margin + gap'),
    ('ZG0', 'CSSInspectorMain', 'Componente raiz que junta as sections'),
    ('qG0', 'CSSInspectorHeader', 'Toggle Design/CSS'),
    ('$G0', 'EffectsSection', 'Box-shadow + blur + opacity'),
]

# Procura outros componentes G0 que existam
print('\nlooking for additional G0 components...')
for m in re.finditer(r'function ([A-Za-z]G0)\(n\)\{', F):
    name = m.group(1)
    if name not in [c[0] for c in COMPONENTS]:
        print(f'  found extra: {name}')
        COMPONENTS.append((name, 'Unknown' + name, 'unidentified'))


# Templates conhecidos (st() prefixes) — descobertos via grep nas functions
TEMPLATES = [
    ('efw', 'PositionSection_HTML'),
    ('Ppw', 'LayoutSection_HTML'),
    ('Xmw', 'EffectsSection_HTML'),
    ('Vmw', 'OG0_HTML'),
    ('gpw', 'VG0_HTML'),
    ('Epw', 'KG0_HTML'),
    ('kpw', 'jG0_HTML'),
    ('zmw', 'CornerInput_HTML'),
]

print('\nextracting components...')
for name, label, desc in COMPONENTS:
    body = extract_function(name)
    if not body:
        print(f'  {name}: NOT FOUND')
        continue
    out_path = os.path.join(OUT_DIR, f'{label}__{name}.js')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(f'// {label} ({name}) — {desc}\n')
        f.write(f'// Extracted raw from workbench.desktop.main.js\n')
        f.write(f'// Length: {len(body)} chars\n\n')
        f.write(body)
    print(f'  {name} → {label} ({len(body):,} chars)')


print('\nextracting templates...')
for prefix, label in TEMPLATES:
    tpl = extract_template(prefix)
    if not tpl:
        print(f'  {prefix}: NOT FOUND')
        continue
    out_path = os.path.join(OUT_DIR, f'template_{label.replace(" ", "_")}__{prefix}.js')
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(f'// Template: {label} ({prefix})\n')
        f.write(f'// Extracted raw — string passed to Solid.js st()\n\n')
        f.write(tpl)
    print(f'  {prefix} → {label} ({len(tpl):,} chars)')


# Tambem extrai value computations e helpers principais
print('\nextracting helpers (qn, ni, BZ, etc) - look for biggest matches...')
for h in ['qn', 'ni', 'BZ', 'si', 'wr']:
    # procura definicao no contexto do CSS Inspector
    pattern = rf'{h}=(?:\(|[a-zA-Z(])'
    matches = []
    for m in re.finditer(pattern, F):
        ctx = F[max(0, m.start()-50):m.start()+150]
        # Heurística: queremos definição global, não atribuição interna
        if 'function' in ctx[-100:] or ',' in F[max(0, m.start()-2):m.start()]:
            matches.append(m.start())
    if matches:
        # pega a primeira definição "robust" — heurística simples
        print(f'  {h}: {len(matches)} candidate definitions found')

print('\ndone! see', OUT_DIR)
