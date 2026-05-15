//! One PTY session: master/slave/child + blocking reader thread + async
//! coalescer task. Field declaration order encodes drop order — see
//! `Drop for Session` and the wezterm Windows ConPTY notes.
