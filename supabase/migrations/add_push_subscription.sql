-- Add push_subscription column to store Web Push subscriptions per tag
alter table tags add column if not exists push_subscription jsonb default null;
