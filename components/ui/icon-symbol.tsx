// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolWeight } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, type StyleProp, type TextStyle } from 'react-native';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];

/**
 * SF Symbol -> Material Icon mappings. Every name used anywhere in the app must
 * appear here, otherwise Android and web render nothing.
 */
const MAPPING = {
  // Navigation
  'house.fill': 'home',
  'list.bullet': 'format-list-bulleted',
  'trophy.fill': 'emoji-events',
  'gearshape.fill': 'settings',
  sparkles: 'auto-awesome',
  'chevron.right': 'chevron-right',
  'chevron.left': 'chevron-left',
  'chevron.up': 'expand-less',
  'chevron.down': 'expand-more',
  'chevron.left.forwardslash.chevron.right': 'code',
  'arrow.left': 'arrow-back',
  'arrow.right': 'arrow-forward',
  'arrow.up.right': 'north-east',
  'arrow.clockwise': 'refresh',
  ellipsis: 'more-horiz',

  // Actions
  plus: 'add',
  minus: 'remove',
  xmark: 'close',
  checkmark: 'check',
  trash: 'delete',
  pencil: 'edit',
  'square.and.pencil': 'edit-note',
  'square.and.arrow.up': 'share',
  magnifyingglass: 'search',
  'slider.horizontal.3': 'tune',
  'paperplane.fill': 'send',
  'hand.thumbsup.fill': 'thumb-up',
  'hand.thumbsdown.fill': 'thumb-down',

  // Content types
  'camera.fill': 'photo-camera',
  photo: 'image',
  'photo.on.rectangle': 'photo-library',
  'photo.badge.plus': 'add-photo-alternate',
  'text.alignleft': 'notes',
  textformat: 'text-fields',
  'doc.text.fill': 'description',
  'doc.badge.plus': 'post-add',

  // Status
  'checkmark.circle.fill': 'check-circle',
  'checkmark.circle': 'check-circle-outline',
  'checkmark.seal.fill': 'verified',
  'xmark.circle.fill': 'cancel',
  'exclamationmark.triangle.fill': 'warning',
  'info.circle.fill': 'info',
  'questionmark.circle.fill': 'help',
  'clock.fill': 'schedule',
  'clock.arrow.circlepath': 'history',
  'flag.fill': 'flag',
  'bolt.fill': 'bolt',
  'star.fill': 'star',
  'eye.fill': 'visibility',
  'bell.fill': 'notifications',
  'lock.fill': 'lock',

  // Entities
  'person.fill': 'person',
  'person.2.fill': 'groups',
  calendar: 'calendar-today',
  'chart.bar.fill': 'bar-chart',
  'tray.fill': 'inbox',
  'wifi.slash': 'wifi-off',
} satisfies Record<string, MaterialIconName>;

export type IconSymbolName = keyof typeof MAPPING;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return (
    <MaterialIcons
      color={color}
      size={size}
      name={MAPPING[name]}
      style={style}
    />
  );
}
