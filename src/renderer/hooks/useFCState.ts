import { useState, useEffect } from 'react';
import type { FCState } from '@shared/types/fcState.types';
import { EMPTY_FC_STATE } from '@shared/types/fcState.types';

export function useFCState(): FCState {
  const [state, setState] = useState<FCState>(EMPTY_FC_STATE);

  useEffect(() => {
    let isActive = true;
    let hasLiveUpdate = false;

    // Subscribe FIRST to avoid missing events during the async fetch
    const unsub = window.betaflight.onFCStateChanged((newState) => {
      hasLiveUpdate = true;
      if (isActive) setState(newState);
    });

    // Then fetch cached state — only apply if no live update arrived first
    window.betaflight
      .getFCState()
      .then((cached) => {
        if (isActive && !hasLiveUpdate && cached) setState(cached);
      })
      .catch(() => {});

    return () => {
      isActive = false;
      unsub();
    };
  }, []);

  return state;
}
