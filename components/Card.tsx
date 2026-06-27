import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Colors, Radius, Shadow } from '@/constants/theme';
import { flattenStyle } from '@/utils/flatten-style';

interface CardProps {
  children: ReactNode;
  style?: object;
}

export function Card({ children, style }: CardProps) {
  return (
    <View style={flattenStyle([styles.card, style])}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: 16,
    ...Shadow.card,
  },
});