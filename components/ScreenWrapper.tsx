import React, { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useParentScreenInsets } from '@/context/ParentNavigationContext';
import { Colors } from '@/constants/theme';
import { flattenStyle } from '@/utils/flatten-style';

interface ScreenWrapperProps {
  children: ReactNode;
  style?: object;
}

export function ScreenWrapper({ children, style }: ScreenWrapperProps) {
  const insets = useParentScreenInsets();

  return (
    <View
      style={flattenStyle([
        styles.container,
        {
          paddingTop: insets.top,
          paddingBottom: insets.bottom,
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
        style,
      ])}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
