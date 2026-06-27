/**
 * ErrorBoundary Component
 *
 * Wraps the app to catch React errors and report them to CatDoes Watch.
 * Displays a fallback UI when an error occurs.
 */

import React from "react";
import { WatchErrorBoundary } from "@catdoes/watch";
import { Box } from "./ui/box";
import { VStack } from "./ui/vstack";
import { Text } from "./ui/text";
import { AlertTriangle } from "lucide-react-native";

interface ErrorFallbackProps {
  error: Error;
  errorInfo: React.ErrorInfo;
  resetError: () => void;
}

/**
 * Fallback UI displayed when an error is caught
 */
function ErrorFallback({ error }: ErrorFallbackProps) {
  return (
    <Box className="flex-1 bg-background-50 items-center justify-center p-6">
      <VStack space="lg" className="items-center max-w-md">
        <AlertTriangle size={48} className="text-red-500" />
        <Text className="text-xl font-semibold text-center">
          Something went wrong
        </Text>
        <Text className="text-sm text-typography-500 text-center">
          {error?.message || "An unexpected error occurred"}
        </Text>
      </VStack>
    </Box>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

/**
 * Error boundary component that integrates with CatDoes Watch
 *
 * Wraps children in a WatchErrorBoundary that automatically reports
 * errors to CatDoes Watch and displays a fallback UI.
 */
export function ErrorBoundary({ children, onError }: ErrorBoundaryProps) {
  return (
    <WatchErrorBoundary
      fallback={ErrorFallback}
      onError={onError}
      captureErrors={true}
    >
      {children}
    </WatchErrorBoundary>
  );
}
