-- The primary contact always receives documents. Store that on existing rows.
UPDATE `client_contacts` SET `is_billing` = 1 WHERE `is_primary` = 1 AND `is_billing` = 0;
