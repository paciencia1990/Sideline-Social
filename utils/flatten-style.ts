import {
  Platform,
  StyleSheet,
  StyleProp,
  ViewStyle,
  TextStyle,
  ImageStyle,
} from "react-native";

type Style = ViewStyle | TextStyle | ImageStyle;

/**
 * Flattens style arrays on web to avoid the CSSStyleDeclaration indexed property error.
 * On native platforms, returns the style array as-is to preserve React Native's optimizations.
 */
export const flattenStyle = <T extends Style>(
  styles: StyleProp<T>,
): StyleProp<T> =>
  Platform.OS === "web" ? (StyleSheet.flatten(styles) as T) : styles;
