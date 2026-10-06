# Motion

The Motion card runs each motion pattern from the brand book on the system's duration and easing tokens; Replay runs them again.

## Patterns shown
Press, arrive, success, first view, start day, loading, on duty, sheet and switch tab, each captioned with its tokens. The README's Motion section says when each one is used.

## The consumer provides
Nothing: this card is a reference. On web, components carry their motion through `bundle.css` (`ks-enter`, `ks-stagger`, `ks-pop`, `ks-draw`, `ks-bob`) and the duration and easing variables. On mobile, `ui-mobile` drives the same patterns with Reanimated and the same tokens.

## Rules
- Use these patterns; don't invent one per screen. Each animation answers "what just happened?" or "where did it go?".
- Animate `transform` and `opacity` only. Count-ups and fills run once per session, so figures never dance on refresh.
- Reduced motion makes every pattern instant. Entry-level phones stop the loops (shimmer, pulse, bob) and keep the rest.
