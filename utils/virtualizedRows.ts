import React, { type ReactNode } from "react";

export type VirtualizedContentRow = { key: string; node: ReactNode };

// Flatten only fragments/arrays. Cards and controls remain intact native rows.
// Children.toArray preserves each JSX slot and explicit item key as lists grow.
export function flattenVirtualizedRows(children: ReactNode, prefix = ""): VirtualizedContentRow[] {
  return React.Children.toArray(children).flatMap((node, index) => {
    const key = prefix + (React.isValidElement(node) && node.key != null ? node.key : index);
    if (React.isValidElement<{ children?: ReactNode }>(node) && node.type === React.Fragment) {
      return flattenVirtualizedRows(node.props.children, key + "/");
    }
    return [{ key, node }];
  });
}
