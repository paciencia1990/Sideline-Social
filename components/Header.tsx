import React, { ReactNode } from "react";
import { StyleProp, StyleSheet, Text, TextStyle, TouchableOpacity, View, ViewStyle } from "react-native";
import { ChevronLeft } from "lucide-react-native";

import { Colors, Spacing, Typography } from "@/constants/theme";
import { flattenStyle } from "@/utils/flatten-style";

interface HeaderProps {
  title: string;
  subtitle?: string;
  leftAction?: () => void;
  right?: ReactNode;
  style?: StyleProp<ViewStyle>;
  titleStyle?: StyleProp<TextStyle>;
}

export function Header({ title, subtitle, leftAction, right, style, titleStyle }: HeaderProps) {
  return (
    <View style={flattenStyle([styles.container, style])}>
      <View style={styles.side}>
        {leftAction ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Go back"
            activeOpacity={0.75}
            onPress={leftAction}
            style={styles.iconButton}
          >
            <ChevronLeft size={24} color={Colors.textHeading} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.copy}>
        <Text numberOfLines={1} style={flattenStyle([styles.title, titleStyle])}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={styles.side}>{right}</View>
    </View>
  );
}

export default Header;

const styles = StyleSheet.create({
  container: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.background,
  },
  side: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.sm,
  },
  title: {
    fontFamily: Typography.heading,
    fontSize: 22,
    color: Colors.textHeading,
    textAlign: "center",
  },
  subtitle: {
    marginTop: 2,
    fontFamily: Typography.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.textPrimary,
    textAlign: "center",
  },
});