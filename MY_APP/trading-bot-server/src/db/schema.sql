-- db/schema.sql

CREATE DATABASE IF NOT EXISTS `trading_bot`;

USE `trading_bot`;

-- --------------------------------------------------------

--
-- Table structure for table `support_resistance`
--
-- This table stores all the support and resistance levels defined by the user.
-- The trading bot loads active levels from this table into memory on startup.
--
CREATE TABLE `support_resistance` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `symbol` VARCHAR(50) NOT NULL COMMENT 'The underlying symbol, e.g., NIFTY, BANKNIFTY',
  `price_level` DECIMAL(10, 2) NOT NULL COMMENT 'The price point of the S/R level',
  `level_type` ENUM('support', 'resistance') NOT NULL COMMENT 'The type of the level',
  `option_contract` VARCHAR(100) DEFAULT NULL COMMENT 'The specific option contract to trade, e.g., NIFTY24JUL25000CE',
  `option_action` ENUM('buy', 'sell') DEFAULT NULL COMMENT 'The action to take on the option contract',
  `expiry` VARCHAR(50) DEFAULT NULL COMMENT 'Expiry identifier, e.g., "current" or a specific date "25-Jul-2024"',
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'If FALSE, the bot will ignore this level',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deactivated_at` TIMESTAMP NULL DEFAULT NULL COMMENT 'Timestamp when the level was deactivated',
  PRIMARY KEY (`id`),
  INDEX `idx_symbol_is_active` (`symbol`, `is_active`) COMMENT 'Index for quick loading of active levels by the bot'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `trades`
--
-- This table logs every trade executed by the bot. It links back
-- to the support_resistance level that triggered it.
--
CREATE TABLE `trades` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `level_id_triggered` INT UNSIGNED NOT NULL COMMENT 'Foreign key to the support_resistance table',
  `order_id` VARCHAR(100) NOT NULL COMMENT 'The order ID received from the broker',
  `status` VARCHAR(50) NOT NULL COMMENT 'e.g., "PLACED", "EXECUTED", "REJECTED"',
  `tradingsymbol` VARCHAR(100) NOT NULL COMMENT 'The contract that was traded',
  `transactiontype` ENUM('BUY', 'SELL') NOT NULL,
  `quantity` INT NOT NULL,
  `price` DECIMAL(10, 2) DEFAULT NULL COMMENT 'Execution price',
  `timestamp` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_level_id_triggered` (`level_id_triggered`),
  CONSTRAINT `fk_level_id_triggered` FOREIGN KEY (`level_id_triggered`) REFERENCES `support_resistance` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;