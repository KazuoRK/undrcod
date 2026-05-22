/**
 * Logo UNDRCOD — [U] em bracket-mono style.
 *
 * Paths vetorizados via Affinity imageTrace do PNG original (1254×1254).
 * Cores exatas extraídas pelo trace: brackets #f6794a, U #f4eee3.
 *
 * Modos:
 *   <Logo size={24} />       inline com squircle background (Affinity completo)
 *   <Logo size={24} mark />  só [U] sem squircle (transparente)
 *   <Logo size={24} mono />  monocromático via currentColor (statusbar etc.)
 */

import logoBoxedUrl from '../../assets/logo.svg';

interface LogoProps {
  size?: number | string;
  className?: string;
  /** Versão sem squircle background — só os 3 paths do [U]. */
  mark?: boolean;
  /** Versão completa com squircle preto (app icon style). Default true. */
  boxed?: boolean;
  /** Força tudo na currentColor (pra contextos onde a cor herda do CSS). */
  mono?: boolean;
}

// Paths exatos extraídos do Affinity imageTrace (viewBox 0 0 5225 5225)
const PATH_U = 'M3084.545,1769.832c90.085,-0.561 142.27,-7.894 166.727,29.981c14.451,22.38 12.769,24.309 12.601,248.855c-0.636,851.312 12.774,859.437 -74.554,1039.802c-218.517,451.32 -1060.329,458.382 -1206.732,-141.812c-20.704,-84.879 -25.829,-105.887 -21.439,-1091.88c0.039,-8.669 0.374,-84.058 67.197,-85.02c105.892,-1.524 155.276,-7.411 176.259,45.163c10.827,27.127 1.922,819.701 5.278,958.408c11.016,455.258 541.457,506.153 730.126,243.718c105.364,-146.56 70.743,-277.376 75.41,-953.074c1.713,-248.045 -14.442,-281.233 69.127,-294.14Z';

const PATH_BRACKET_RIGHT = 'M3666.169,1366.651c352.171,-0.352 356.117,-3.071 386.068,20.932c49.274,39.489 38.587,54.812 40.271,314.11c3.821,588.458 0.116,1877.726 -0.353,2041.006c-0.385,133.827 -105.347,114.137 -252.485,114.175c-329.526,0.085 -331.85,0.87 -350.486,-13.862c-29.887,-23.626 -35.46,-143.316 8.239,-167.265c34.241,-18.766 387.202,-0.152 397.497,-10.462c5.585,-5.594 1.933,-742.396 2.883,-1688.06c0.383,-380.983 5.436,-381.213 -0.722,-413.733c-3.973,-20.983 -368.124,8.518 -402.981,-16.831c-13.867,-10.085 -30.773,-17.418 -25.765,-120.443c3.521,-72.427 73.043,-59.773 197.835,-59.565Z';

const PATH_BRACKET_LEFT = 'M1691.498,1366.696c71.012,8.442 64.6,42.478 64.736,110.468c0.179,89.403 -45.724,79.252 -125.992,79.384c-285.367,0.468 -299.837,-3.144 -302.651,6.82c-1.892,6.697 -0.805,2090.195 -0.661,2092.831c1.066,19.56 13.196,9.8 369.649,11.776c38.062,0.211 59.119,30.885 59.357,59.506c0.467,56.169 4.687,86.029 -15.172,110.783c-18.738,23.357 -24.859,18.261 -360.52,18.471c-121.502,0.076 -225.07,17.11 -244.927,-78.306c-6.097,-29.295 -1.64,-1064.008 -3.081,-2081.841c-0.348,-245.636 -9.186,-289.735 59.65,-320.454c20.85,-9.305 21.702,-10.252 499.613,-9.439Z';

// Brand colors — UNDRCOD Antigravity Blue.
// `mono` mode overrides both via currentColor.
const BRACKET_COLOR = '#4F8FFA';   // brackets em brand blue
const LETTER_COLOR = '#F2ECE3';    // U em warm cream (alto contraste sobre dark)

export function Logo({ size = '1em', className = '', mark = false, boxed = false, mono = false }: LogoProps) {
  const dimension = typeof size === 'number' ? `${size}px` : size;

  // Default = mark (sem fundo, só [U] laranja + creme).
  // Squircle só quando explicitamente boxed=true.
  if (boxed && !mark) {
    return (
      <img
        src={logoBoxedUrl}
        width={dimension}
        height={dimension}
        alt="UNDRCOD"
        className={className}
        style={{ display: 'inline-block', verticalAlign: 'middle' }}
      />
    );
  }

  // Versão mark — só [U] sem squircle, fills controláveis
  const bracketFill = mono ? 'currentColor' : BRACKET_COLOR;
  const letterFill = mono ? 'currentColor' : LETTER_COLOR;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="950 945 3325 3325"
      width={dimension}
      height={dimension}
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
      aria-label="UNDRCOD"
    >
      <path d={PATH_BRACKET_LEFT} fill={bracketFill} />
      <path d={PATH_U} fill={letterFill} />
      <path d={PATH_BRACKET_RIGHT} fill={bracketFill} />
    </svg>
  );
}
