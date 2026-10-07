import { Platform, TextStyle } from 'react-native';

/**
 * Sapsut design system — "warm editorial".
 *
 * Surfaces are layered warm neutrals, orange is reserved for action and
 * emphasis, and both schemes stay inside the same brand family so light and
 * dark read as one product.
 */

export const Palette = {
  light: {
    canvas: '#FDF6EC',
    canvasAlt: '#F7EBD9',
    surface: '#FFFFFF',
    surfaceSunken: '#F5EADA',
    surfaceInverse: '#2C1E12',

    border: '#EADCC6',
    borderStrong: '#D8C3A4',

    textPrimary: '#2C1E12',
    textSecondary: '#705B45',
    textTertiary: '#9B8671',
    textInverse: '#FFF9F0',

    accent: '#E07B18',
    accentPressed: '#C06410',
    accentSoft: '#FBE7CE',
    accentOnSoft: '#8A4A08',
    onAccent: '#FFFFFF',

    brick: '#B84C2B',
    brickSoft: '#F8DED5',
    onBrickSoft: '#8A3420',

    success: '#2F7D4F',
    successSoft: '#DCF0E4',
    onSuccessSoft: '#1B5434',

    warning: '#B07C18',
    warningSoft: '#FBEBC9',
    onWarningSoft: '#79530C',

    danger: '#C0392B',
    dangerSoft: '#FADCD8',
    onDangerSoft: '#8B271C',

    gold: '#C9971B',
    silver: '#8E8B86',
    bronze: '#A9713C',

    shadow: '#4A3014',
    scrim: 'rgba(44, 30, 18, 0.45)',
    skeleton: '#EFE2CE',
    skeletonSheen: '#F8F0E3',
  },
  dark: {
    canvas: '#171310',
    canvasAlt: '#1C1713',
    surface: '#231C16',
    surfaceSunken: '#120F0C',
    surfaceInverse: '#FDF6EC',

    border: '#352B22',
    borderStrong: '#4C3D31',

    textPrimary: '#F8EFE2',
    textSecondary: '#BFAB95',
    textTertiary: '#8C7A66',
    textInverse: '#2C1E12',

    accent: '#F59235',
    accentPressed: '#D97A1F',
    accentSoft: '#3A2613',
    accentOnSoft: '#F7B97A',
    onAccent: '#241502',

    brick: '#E0714D',
    brickSoft: '#3B1F15',
    onBrickSoft: '#F0A188',

    success: '#5BBE86',
    successSoft: '#17301F',
    onSuccessSoft: '#8FD9AE',

    warning: '#E0AE4A',
    warningSoft: '#33260D',
    onWarningSoft: '#F0CE8B',

    danger: '#EC7566',
    dangerSoft: '#3A1A16',
    onDangerSoft: '#F5A79C',

    gold: '#E3B340',
    silver: '#B6B2AC',
    bronze: '#C98F57',

    shadow: '#000000',
    scrim: 'rgba(0, 0, 0, 0.6)',
    skeleton: '#2A221B',
    skeletonSheen: '#352B22',
  },
} as const;

export type ColorScheme = keyof typeof Palette;
export type ThemeColors = (typeof Palette)[ColorScheme];

/** 4pt base spacing scale. */
export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 40,
  huge: 56,
} as const;

export const Radius = {
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const FontFamily = {
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  mono: Platform.select({
    ios: 'ui-monospace',
    android: 'monospace',
    default: 'monospace',
  }) as string,
} as const;

/**
 * Type ramp. Display sizes use the serif; everything functional uses Inter so
 * body copy stays legible at small sizes.
 */
export const Typography = {
  displayLarge: {
    fontFamily: FontFamily.displayBold,
    fontSize: 36,
    lineHeight: 42,
    letterSpacing: -0.6,
  },
  display: {
    fontFamily: FontFamily.display,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.4,
  },
  heading: {
    fontFamily: FontFamily.display,
    fontSize: 23,
    lineHeight: 29,
    letterSpacing: -0.2,
  },
  title: {
    fontFamily: FontFamily.sansSemiBold,
    fontSize: 17,
    lineHeight: 23,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: FontFamily.sans,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  bodyStrong: {
    fontFamily: FontFamily.sansMedium,
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  callout: {
    fontFamily: FontFamily.sans,
    fontSize: 14,
    lineHeight: 20,
    letterSpacing: -0.05,
  },
  label: {
    fontFamily: FontFamily.sansSemiBold,
    fontSize: 13,
    lineHeight: 17,
    letterSpacing: 0,
  },
  caption: {
    fontFamily: FontFamily.sans,
    fontSize: 12.5,
    lineHeight: 17,
    letterSpacing: 0,
  },
  overline: {
    fontFamily: FontFamily.sansSemiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  numeric: {
    fontFamily: FontFamily.sansBold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  numericLarge: {
    fontFamily: FontFamily.sansBold,
    fontSize: 28,
    lineHeight: 33,
    letterSpacing: -0.8,
    fontVariant: ['tabular-nums'],
  },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof Typography;

/**
 * Warm-tinted elevation. Android only renders `elevation`, so the two are kept
 * in sync per level.
 */
export function elevation(level: 0 | 1 | 2 | 3, shadowColor: string) {
  if (level === 0) return {};
  const config = {
    1: { opacity: 0.07, radius: 8, offset: 2, elevation: 2 },
    2: { opacity: 0.1, radius: 18, offset: 6, elevation: 5 },
    3: { opacity: 0.14, radius: 32, offset: 12, elevation: 10 },
  }[level];

  return {
    shadowColor,
    shadowOpacity: config.opacity,
    shadowRadius: config.radius,
    shadowOffset: { width: 0, height: config.offset },
    elevation: config.elevation,
  };
}

export const Motion = {
  fast: 140,
  base: 220,
  slow: 360,
  pressScale: 0.97,
} as const;

export const HitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;
