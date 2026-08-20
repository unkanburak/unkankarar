export const motionTokens = {
  duration: {
    micro: 0.16,
    card: 0.42,
    scene: 0.72,
    reveal: 1.05,
    elimination: 0.62,
    roulette: 1.9,
    lock: 0.72,
  },
  ease: {
    standard: [0.22, 1, 0.36, 1] as const,
    entrance: [0.16, 1, 0.3, 1] as const,
    exit: [0.7, 0, 0.84, 0] as const,
  },
  spring: {
    button: { type: "spring" as const, stiffness: 520, damping: 28, mass: 0.7 },
    card: { type: "spring" as const, stiffness: 250, damping: 20, mass: 0.9 },
    heavy: { type: "spring" as const, stiffness: 150, damping: 24, mass: 1.1 },
  },
};

export const sceneVariants = {
  enter: { opacity: 0, y: 18, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -12, filter: "blur(3px)" },
};
