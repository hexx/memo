ALTER TABLE `memos` ADD `entry_date` text;--> statement-breakpoint
CREATE UNIQUE INDEX `memos_entry_date_unique` ON `memos` (`entry_date`);