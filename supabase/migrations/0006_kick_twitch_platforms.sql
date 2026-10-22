-- 0006_kick_twitch_platforms.sql
-- Add Kick and Twitch as supported order/service platforms.

alter type platform_t add value if not exists 'kick';
alter type platform_t add value if not exists 'twitch';
