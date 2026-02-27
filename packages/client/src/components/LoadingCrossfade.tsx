import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';

interface LoadingCrossfadeProps {
  isLoading: boolean;
  skeleton: ReactNode;
  children: ReactNode;
}

export default function LoadingCrossfade({ isLoading, skeleton, children }: LoadingCrossfadeProps) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      {isLoading ? (
        <motion.div
          key="skeleton"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
        >
          {skeleton}
        </motion.div>
      ) : (
        <motion.div
          key="content"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
