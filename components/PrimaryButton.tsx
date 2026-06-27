import React from 'react';
import { StyleSheet, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Colors, Typography, Radius } from '@/constants/theme';
import { flattenStyle } from '@/utils/flatten-style';

interface PrimaryButtonProps {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: object;
}

export function PrimaryButton({ title, onPress, loading, disabled, style }: PrimaryButtonProps) {
  return (
    <TouchableOpacity
      style={flattenStyle([styles.button, disabled && styles.disabled, style])}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <Text style={styles.label}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.button,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  label: {
    fontFamily: Typography.bodySemiBold,
    fontSize: 16,
    color: '#FFFFFF',
  },
  disabled: {
    opacity: 0.6,
  },
});