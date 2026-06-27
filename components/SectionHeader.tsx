import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { Colors, Typography, Spacing } from '@/constants/theme';
import { flattenStyle } from '@/utils/flatten-style';

interface SectionHeaderProps {
  title: string;
  style?: object;
}

export function SectionHeader({ title, style }: SectionHeaderProps) {
  return (
    <Text style={flattenStyle([styles.header, style])}>
      {title}
    </Text>
  );
}

const styles = StyleSheet.create({
  header: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: Colors.textHeading,
    marginBottom: Spacing.sm,
  },
});