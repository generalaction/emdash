import React, { createContext, useContext } from 'react';

interface CommentContextValue {
  theme: 'light' | 'dark';
}

const CommentContext = createContext<CommentContextValue>({ theme: 'dark' });

export function useCommentContext() {
  return useContext(CommentContext);
}

interface CommentContextBridgeProps {
  value: CommentContextValue;
  children?: React.ReactNode;
}

export const CommentContextBridge: React.FC<CommentContextBridgeProps> = ({
  value,
  children,
}) => {
  return (
    <CommentContext.Provider value={value}>
      {children}
    </CommentContext.Provider>
  );
};
