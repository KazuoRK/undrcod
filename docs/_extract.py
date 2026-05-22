import re, sys

chunk = open('C:/Users/taked/Desktop/akai-code/docs/_cursor-chunk.txt', encoding='utf-8').read()

targets = ['rs', 'Cs', 'Dl', 'Bs', 'Si', 'Ro', 'Lm', 'c0', 'Uf', 'c_', 'Gf', 'xp',
           'qn', 'ni', 'BZ', 'si', 'wr', 'Ma', 'eu', 'Mr', 'Dr', 'X_', 'Lmw', 'Nmw', 'Mmw',
           'us', 'ro', 'hu', 'Fm', 'Hp', 'fb', 'ff', '_v', 'Pg', 'ks', 'go', 'ko',
           'aa', 'Pl', 'kl', 'Ll', 'td', 'ia', 'Na',
           # padding/margin
           'so', 'Ba', 'ic', 'gc', 'dd',
           # layout/dim modes
           'ch', 'Gh', '$s',
           # min/max
           'mu', 'ap', 'Mg', 'Rg',
           # font etc
           'pu', 'la']

def extract_def(text, name):
    pattern = r'(?:^|[{,;])' + re.escape(name) + r'='
    for m in re.finditer(pattern, text):
        start = m.end()
        depth_p = depth_br = depth_c = 0
        in_str = None
        i = start
        end = -1
        while i < len(text):
            ch = text[i]
            if in_str:
                if ch == chr(92):
                    i += 2
                    continue
                if ch == in_str:
                    in_str = None
            else:
                if ch in ('"', "'", '`'):
                    in_str = ch
                elif ch == '(':
                    depth_p += 1
                elif ch == ')':
                    depth_p -= 1
                elif ch == '[':
                    depth_br += 1
                elif ch == ']':
                    depth_br -= 1
                elif ch == '{':
                    depth_c += 1
                elif ch == '}':
                    if depth_c == 0:
                        end = i
                        break
                    depth_c -= 1
                elif ch == ',' and depth_p == 0 and depth_br == 0 and depth_c == 0:
                    end = i
                    break
                elif ch == ';' and depth_p == 0 and depth_br == 0 and depth_c == 0:
                    end = i
                    break
            i += 1
        if end > 0:
            return text[start:end].strip()
    return None

out = []
for name in targets:
    d = extract_def(chunk, name)
    if d:
        if len(d) > 1500:
            d = d[:1500] + '...[TRUNC]'
        out.append(f'\n===== {name} =====\n{d}')
print('\n'.join(out))
