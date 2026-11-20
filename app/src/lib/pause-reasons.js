// pause-reasons — why the timer (and the music with it) is on hold.
//
// Several things can pause it independently: the user ('manual'), hiding the bubble
// ('hidden'), a locked screen ('locked'). Each is recorded even when the timer is already
// paused for another reason, and the timer runs again only once none is left. So a hidden
// bubble stays paused through any lock/unlock, in any order, and an unlock resumes only
// what the lock paused.
export function createPauseReasons() {
  const reasons = new Set();
  return {
    add(reason) { reasons.add(reason); },
    remove(reason) { reasons.delete(reason); },
    clear() { reasons.clear(); },     // the user explicitly resumes: their choice wins
    get paused() { return reasons.size > 0; },
  };
}
