import { duration, easing } from '@kshetra/design-tokens';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, Easing, type EasingFunction } from 'react-native';

/** Whether the phone asks for reduced motion. Motion then turns instant (README, Motion). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      live = false;
      subscription.remove();
    };
  }, []);
  return reduced;
}

type Curve = Exclude<keyof typeof easing, 'easeLinear'>;

/** An easing token as a React Native easing function. */
export function ease(curve: Curve): EasingFunction {
  const [x1, y1, x2, y2] = easing[curve];
  return Easing.bezier(x1, y1, x2, y2);
}

export { duration };
