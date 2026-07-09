import type { Transition } from 'motion/react';

type CubicBezier = [number, number, number, number];

export const motionDurations = {
  instant: 0.09,
  fast: 0.14,
  standard: 0.18,
  gentle: 0.24,
  emphasized: 0.28,
} as const;

export const motionEase = {
  standard: [0.2, 0, 0, 1] as CubicBezier,
  enter: [0.16, 1, 0.3, 1] as CubicBezier,
  exit: [0.4, 0, 1, 1] as CubicBezier,
  emphasized: [0.2, 0.8, 0.2, 1] as CubicBezier,
} as const;

export const motionTransitions = {
  fast: { duration: motionDurations.fast, ease: motionEase.standard },
  standard: { duration: motionDurations.standard, ease: motionEase.standard },
  enter: { duration: motionDurations.gentle, ease: motionEase.enter },
  exit: { duration: motionDurations.fast, ease: motionEase.exit },
  emphasized: { duration: motionDurations.emphasized, ease: motionEase.emphasized },
  spring: { type: 'spring', stiffness: 420, damping: 34, mass: 0.72 },
} satisfies Record<string, Transition>;

export const fadeSoftMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: motionTransitions.standard,
};

export const panelRevealMotion = {
  initial: { opacity: 0, x: -10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -8 },
  transition: motionTransitions.enter,
};

export const sheetRevealMotion = {
  initial: { opacity: 0, scale: 0.985, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.985, y: 4 },
  transition: motionTransitions.enter,
};

export const rightRailRevealMotion = {
  initial: { opacity: 0, x: 10 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: 8 },
  transition: motionTransitions.enter,
};

export const editorCrossfadeMotion = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -3 },
  transition: motionTransitions.standard,
};

export const tabLayoutTransition = motionTransitions.spring;

export function listItemEnterMotion(index: number, reducedMotion = false) {
  const delay = reducedMotion ? 0 : Math.min(index * 0.03, 0.18);
  return {
    initial: reducedMotion ? { opacity: 1 } : { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: reducedMotion ? { opacity: 0 } : { opacity: 0, y: -2 },
    transition: {
      ...motionTransitions.standard,
      delay,
    },
  };
}
