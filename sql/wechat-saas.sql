-- MySQL dump 10.13  Distrib 8.1.0, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: wechat_saas
-- ------------------------------------------------------
-- Server version	5.7.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `wechat_saas`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `wechat_saas` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;

USE `wechat_saas`;

--
-- Table structure for table `flyway_schema_history`
--

DROP TABLE IF EXISTS `flyway_schema_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `flyway_schema_history` (
  `installed_rank` int(11) NOT NULL,
  `version` varchar(50) DEFAULT NULL,
  `description` varchar(200) NOT NULL,
  `type` varchar(20) NOT NULL,
  `script` varchar(1000) NOT NULL,
  `checksum` int(11) DEFAULT NULL,
  `installed_by` varchar(100) NOT NULL,
  `installed_on` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_time` int(11) NOT NULL,
  `success` tinyint(1) NOT NULL,
  PRIMARY KEY (`installed_rank`),
  KEY `flyway_schema_history_s_idx` (`success`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `flyway_schema_history`
--

LOCK TABLES `flyway_schema_history` WRITE;
/*!40000 ALTER TABLE `flyway_schema_history` DISABLE KEYS */;
INSERT INTO `flyway_schema_history` VALUES (1,'1','init','SQL','V1__init.sql',-1951747917,'root','2026-11-26 16:21:09',144,1),(2,'2','business modules','SQL','V2__business_modules.sql',-1795467442,'root','2026-11-26 16:25:48',440,1),(3,'3','engagement modules','SQL','V3__engagement_modules.sql',547176150,'root','2026-11-26 16:45:27',203,1);
/*!40000 ALTER TABLE `flyway_schema_history` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_appointment_services`
--

DROP TABLE IF EXISTS `saas_appointment_services`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_appointment_services` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `name` varchar(40) NOT NULL,
  `price_cent` bigint(20) NOT NULL DEFAULT '0',
  `duration_minutes` int(11) NOT NULL DEFAULT '60',
  `capacity_per_slot` int(11) NOT NULL DEFAULT '1',
  `slots_json` text NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_appt_service_tenant` (`tenant_id`),
  CONSTRAINT `fk_appt_service_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_appointment_services`
--

LOCK TABLES `saas_appointment_services` WRITE;
/*!40000 ALTER TABLE `saas_appointment_services` DISABLE KEYS */;
INSERT INTO `saas_appointment_services` VALUES (1,1,'MySQL预约服务',3900,60,1,'[\"09:00\",\"10:00\"]',1,'2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_appointment_services` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_appointments`
--

DROP TABLE IF EXISTS `saas_appointments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_appointments` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `service_id` bigint(20) NOT NULL,
  `service_name` varchar(40) NOT NULL,
  `member_id` bigint(20) NOT NULL,
  `appointment_date` varchar(10) NOT NULL,
  `slot` varchar(10) NOT NULL,
  `note` varchar(100) DEFAULT NULL,
  `status` varchar(24) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_appt_service` (`service_id`),
  KEY `fk_appt_member` (`member_id`),
  KEY `idx_appointments_tenant_slot` (`tenant_id`,`service_id`,`appointment_date`,`slot`,`status`),
  CONSTRAINT `fk_appt_member` FOREIGN KEY (`member_id`) REFERENCES `saas_members` (`id`),
  CONSTRAINT `fk_appt_service` FOREIGN KEY (`service_id`) REFERENCES `saas_appointment_services` (`id`),
  CONSTRAINT `fk_appt_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_appointments`
--

LOCK TABLES `saas_appointments` WRITE;
/*!40000 ALTER TABLE `saas_appointments` DISABLE KEYS */;
INSERT INTO `saas_appointments` VALUES (1,1,1,'MySQL预约服务',4,'2026-11-28','09:00','MySQL联调','CANCELLED','2026-11-26 08:46:04','2026-11-26 08:46:04',NULL);
/*!40000 ALTER TABLE `saas_appointments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_audit_logs`
--

DROP TABLE IF EXISTS `saas_audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_audit_logs` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `actor_type` varchar(24) NOT NULL,
  `actor_id` bigint(20) DEFAULT NULL,
  `action` varchar(80) NOT NULL,
  `resource` varchar(80) DEFAULT NULL,
  `resource_id` varchar(80) DEFAULT NULL,
  `detail` varchar(1000) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor_name` varchar(80) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audit_tenant_created` (`tenant_id`,`created_at`),
  CONSTRAINT `fk_audit_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=23 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_audit_logs`
--

LOCK TABLES `saas_audit_logs` WRITE;
/*!40000 ALTER TABLE `saas_audit_logs` DISABLE KEYS */;
INSERT INTO `saas_audit_logs` VALUES (1,1,'ADMIN',1,'product.create','product','5','{\"name\":\"联调测试商品\",\"stock\":10,\"priceCent\":1200}','2026-11-26 08:26:47','admin'),(2,1,'ADMIN',1,'inventory.adjust','product','5','{\"after\":15,\"delta\":5,\"before\":10,\"reason\":\"联调补货\"}','2026-11-26 08:26:47','admin'),(3,1,'ADMIN',1,'order.pay','order','2','{\"orderNo\":\"NT202611270002\",\"pointsEarned\":29,\"amountCent\":2980}','2026-11-26 08:26:47','admin'),(4,1,'ADMIN',1,'order.deliver','order','2','{\"orderNo\":\"NT202611270002\",\"trackingNo\":\"SF-20261127\",\"company\":\"顺丰\"}','2026-11-26 08:26:47','admin'),(5,1,'ADMIN',1,'member.points-adjust','member','1','{\"reason\":\"联调补偿\",\"balance\":130,\"change\":10}','2026-11-26 08:26:47','admin'),(6,1,'ADMIN',1,'order.refund','order','2','{\"orderNo\":\"NT202611270002\",\"full\":true,\"refundNo\":\"RF202611270002F8B8FFB8\",\"amountCent\":2980}','2026-11-26 08:28:30','admin'),(7,1,'ADMIN',1,'inventory.adjust','product','5','{\"before\":15,\"reason\":\"联调扣减\",\"after\":14,\"delta\":-1}','2026-11-26 08:30:48','admin'),(8,1,'ADMIN',1,'inventory.adjust-undo','product','5','{\"adjustmentId\":2,\"reversalId\":3,\"after\":15}','2026-11-26 08:30:48','admin'),(9,1,'ADMIN',1,'product.update','product','5','{\"priceCent\":1300,\"name\":\"联调测试商品-已更新\",\"onSale\":true}','2026-11-26 08:30:48','admin'),(10,1,'ADMIN',1,'product.off-shelf','product','5','{\"name\":\"联调测试商品-已更新\"}','2026-11-26 08:30:48','admin'),(11,1,'ADMIN',1,'coupon.template-create','coupon-template','1','{\"name\":\"MySQL满减券\",\"amountCent\":500}','2026-11-26 08:46:04','admin'),(12,1,'ADMIN',4,'coupon.claim','coupon','1','{\"templateId\":1,\"memberId\":4}','2026-11-26 08:46:04','mock_d955909b41480389ad85'),(13,1,'ADMIN',1,'groupbuy.create','group-buy','1','{\"groupPriceCent\":999,\"title\":\"MySQL周末团\",\"productId\":1}','2026-11-26 08:46:04','admin'),(14,1,'ADMIN',4,'groupbuy.join','group-buy','1','{\"memberId\":4,\"role\":\"LEADER\"}','2026-11-26 08:46:04','mock_d955909b41480389ad85'),(15,1,'ADMIN',1,'form.create','form','1','{\"title\":\"MySQL反馈表\"}','2026-11-26 08:46:04','admin'),(16,1,'ADMIN',4,'form.submit','form','1','{\"memberId\":4}','2026-11-26 08:46:04','mock_d955909b41480389ad85'),(17,1,'ADMIN',1,'appointment-service.create','appointment-service','1','{\"capacity\":1,\"name\":\"MySQL预约服务\"}','2026-11-26 08:46:04','admin'),(18,1,'ADMIN',4,'appointment.book','appointment','1','{\"serviceId\":1,\"date\":\"2026-11-28\",\"slot\":\"09:00\"}','2026-11-26 08:46:04','mock_d955909b41480389ad85'),(19,1,'ADMIN',4,'appointment.cancel','appointment','1','{\"memberId\":4}','2026-11-26 08:46:04','mock_d955909b41480389ad85'),(20,1,'ADMIN',1,'wechat.subscription-test','notification','1','{\"templateId\":\"tmpl-order-paid\",\"status\":\"MOCKED\",\"memberId\":4}','2026-11-26 08:46:04','admin'),(21,1,'ADMIN',4,'order.create','order','3','{\"amountCent\":1280,\"orderNo\":\"NT1795711665872DFB34F\"}','2026-11-26 08:47:46','mock_d955909b41480389ad85'),(22,1,'ADMIN',4,'order.pay','order','3','{\"pointsEarned\":12,\"orderNo\":\"NT1795711665872DFB34F\",\"amountCent\":1280}','2026-11-26 08:47:46','mock_d955909b41480389ad85');
/*!40000 ALTER TABLE `saas_audit_logs` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_categories`
--

DROP TABLE IF EXISTS `saas_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_categories` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `name` varchar(40) NOT NULL,
  `sort_order` int(11) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_categories_tenant` (`tenant_id`),
  CONSTRAINT `fk_categories_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_categories`
--

LOCK TABLES `saas_categories` WRITE;
/*!40000 ALTER TABLE `saas_categories` DISABLE KEYS */;
INSERT INTO `saas_categories` VALUES (1,1,'生鲜蔬果',1,'2026-11-26 08:21:12'),(2,1,'社区日用',2,'2026-11-26 08:21:12');
/*!40000 ALTER TABLE `saas_categories` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_coupon_templates`
--

DROP TABLE IF EXISTS `saas_coupon_templates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_coupon_templates` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `name` varchar(40) NOT NULL,
  `threshold_cent` bigint(20) NOT NULL DEFAULT '0',
  `amount_cent` bigint(20) NOT NULL,
  `valid_days` int(11) NOT NULL DEFAULT '30',
  `limit_per_member` int(11) NOT NULL DEFAULT '1',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_coupon_tpl_tenant` (`tenant_id`),
  CONSTRAINT `fk_coupon_tpl_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_coupon_templates`
--

LOCK TABLES `saas_coupon_templates` WRITE;
/*!40000 ALTER TABLE `saas_coupon_templates` DISABLE KEYS */;
INSERT INTO `saas_coupon_templates` VALUES (1,1,'MySQL满减券',1000,500,30,1,1,'2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_coupon_templates` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_coupons`
--

DROP TABLE IF EXISTS `saas_coupons`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_coupons` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `template_id` bigint(20) NOT NULL,
  `member_id` bigint(20) NOT NULL,
  `name` varchar(40) NOT NULL,
  `threshold_cent` bigint(20) NOT NULL,
  `amount_cent` bigint(20) NOT NULL,
  `status` varchar(24) NOT NULL,
  `expire_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reserved_order_id` bigint(20) DEFAULT NULL,
  `used_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_coupon_tpl` (`template_id`),
  KEY `fk_coupon_member` (`member_id`),
  KEY `idx_coupons_tenant_member` (`tenant_id`,`member_id`,`status`),
  CONSTRAINT `fk_coupon_member` FOREIGN KEY (`member_id`) REFERENCES `saas_members` (`id`),
  CONSTRAINT `fk_coupon_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`),
  CONSTRAINT `fk_coupon_tpl` FOREIGN KEY (`template_id`) REFERENCES `saas_coupon_templates` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_coupons`
--

LOCK TABLES `saas_coupons` WRITE;
/*!40000 ALTER TABLE `saas_coupons` DISABLE KEYS */;
INSERT INTO `saas_coupons` VALUES (1,1,1,4,'MySQL满减券',1000,500,'UNUSED','2026-12-26 08:46:04',NULL,NULL,'2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_coupons` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_form_submissions`
--

DROP TABLE IF EXISTS `saas_form_submissions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_form_submissions` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `form_id` bigint(20) NOT NULL,
  `member_id` bigint(20) NOT NULL,
  `answers_json` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_form_member` (`form_id`,`member_id`),
  KEY `fk_submission_tenant` (`tenant_id`),
  KEY `fk_submission_member` (`member_id`),
  CONSTRAINT `fk_submission_form` FOREIGN KEY (`form_id`) REFERENCES `saas_forms` (`id`),
  CONSTRAINT `fk_submission_member` FOREIGN KEY (`member_id`) REFERENCES `saas_members` (`id`),
  CONSTRAINT `fk_submission_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_form_submissions`
--

LOCK TABLES `saas_form_submissions` WRITE;
/*!40000 ALTER TABLE `saas_form_submissions` DISABLE KEYS */;
INSERT INTO `saas_form_submissions` VALUES (1,1,1,4,'{\"f1\":\"社区配送\"}','2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_form_submissions` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_forms`
--

DROP TABLE IF EXISTS `saas_forms`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_forms` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `title` varchar(80) NOT NULL,
  `description` varchar(300) DEFAULT NULL,
  `fields_json` text NOT NULL,
  `status` varchar(24) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_forms_tenant_status` (`tenant_id`,`status`),
  CONSTRAINT `fk_form_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_forms`
--

LOCK TABLES `saas_forms` WRITE;
/*!40000 ALTER TABLE `saas_forms` DISABLE KEYS */;
INSERT INTO `saas_forms` VALUES (1,1,'MySQL反馈表','联调','[{\"id\":\"f1\",\"label\":\"最需要的服务\",\"type\":\"text\",\"options\":[],\"required\":true}]','OPEN','2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_forms` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_group_buy_participants`
--

DROP TABLE IF EXISTS `saas_group_buy_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_group_buy_participants` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `group_buy_id` bigint(20) NOT NULL,
  `member_id` bigint(20) NOT NULL,
  `role` varchar(24) NOT NULL,
  `joined_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group_participant` (`group_buy_id`,`member_id`),
  KEY `fk_group_participant_member` (`member_id`),
  CONSTRAINT `fk_group_participant_group` FOREIGN KEY (`group_buy_id`) REFERENCES `saas_group_buys` (`id`),
  CONSTRAINT `fk_group_participant_member` FOREIGN KEY (`member_id`) REFERENCES `saas_members` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_group_buy_participants`
--

LOCK TABLES `saas_group_buy_participants` WRITE;
/*!40000 ALTER TABLE `saas_group_buy_participants` DISABLE KEYS */;
INSERT INTO `saas_group_buy_participants` VALUES (1,1,4,'LEADER','2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_group_buy_participants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_group_buys`
--

DROP TABLE IF EXISTS `saas_group_buys`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_group_buys` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `product_id` bigint(20) NOT NULL,
  `title` varchar(80) NOT NULL,
  `group_price_cent` bigint(20) NOT NULL,
  `min_participants` int(11) NOT NULL,
  `max_participants` int(11) NOT NULL,
  `status` varchar(24) NOT NULL,
  `start_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `end_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `success_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_group_product` (`product_id`),
  KEY `idx_group_buys_tenant_status` (`tenant_id`,`status`,`end_at`),
  CONSTRAINT `fk_group_product` FOREIGN KEY (`product_id`) REFERENCES `saas_products` (`id`),
  CONSTRAINT `fk_group_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_group_buys`
--

LOCK TABLES `saas_group_buys` WRITE;
/*!40000 ALTER TABLE `saas_group_buys` DISABLE KEYS */;
INSERT INTO `saas_group_buys` VALUES (1,1,1,'MySQL周末团',999,2,10,'ACTIVE','2026-11-26 08:46:04','2026-11-27 08:46:04',NULL,'2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_group_buys` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_inventory_adjustments`
--

DROP TABLE IF EXISTS `saas_inventory_adjustments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_inventory_adjustments` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `product_id` bigint(20) NOT NULL,
  `product_name` varchar(80) NOT NULL,
  `before_stock` int(11) NOT NULL,
  `delta` int(11) NOT NULL,
  `after_stock` int(11) NOT NULL,
  `reason` varchar(200) NOT NULL,
  `actor_id` bigint(20) DEFAULT NULL,
  `actor_name` varchar(80) DEFAULT NULL,
  `undone_at` timestamp NULL DEFAULT NULL,
  `reversed_adjustment_id` bigint(20) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_inventory_product` (`product_id`),
  KEY `idx_inventory_tenant_product` (`tenant_id`,`product_id`,`created_at`),
  CONSTRAINT `fk_inventory_product` FOREIGN KEY (`product_id`) REFERENCES `saas_products` (`id`),
  CONSTRAINT `fk_inventory_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_inventory_adjustments`
--

LOCK TABLES `saas_inventory_adjustments` WRITE;
/*!40000 ALTER TABLE `saas_inventory_adjustments` DISABLE KEYS */;
INSERT INTO `saas_inventory_adjustments` VALUES (1,1,5,'联调测试商品',10,5,15,'联调补货',1,'admin',NULL,NULL,'2026-11-26 08:26:47'),(2,1,5,'联调测试商品',15,-1,14,'联调扣减',1,'admin','2026-11-26 08:30:48',3,'2026-11-26 08:30:48'),(3,1,5,'联调测试商品',14,1,15,'撤销库存调整：联调扣减',1,'admin',NULL,2,'2026-11-26 08:30:48');
/*!40000 ALTER TABLE `saas_inventory_adjustments` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_members`
--

DROP TABLE IF EXISTS `saas_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_members` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `openid` varchar(96) NOT NULL,
  `nickname` varchar(80) NOT NULL,
  `phone` varchar(32) DEFAULT NULL,
  `points` bigint(20) NOT NULL DEFAULT '0',
  `total_spent_cent` bigint(20) NOT NULL DEFAULT '0',
  `order_count` int(11) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_members_tenant_openid` (`tenant_id`,`openid`),
  CONSTRAINT `fk_members_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_members`
--

LOCK TABLES `saas_members` WRITE;
/*!40000 ALTER TABLE `saas_members` DISABLE KEYS */;
INSERT INTO `saas_members` VALUES (1,1,'mock-openid-1','林女士','13800000001',130,12800,2,'2026-11-26 08:21:12','2026-11-26 08:26:47'),(2,1,'mock-openid-2','周先生','13800000002',89,6380,1,'2026-11-26 08:21:12','2026-11-26 08:28:30'),(3,1,'mock-openid-3','陈阿姨','13800000003',210,18600,3,'2026-11-26 08:21:12','2026-11-26 08:21:12'),(4,1,'mock_d955909b41480389ad85','邻居ad85','',12,1280,1,'2026-11-26 08:46:04','2026-11-26 08:47:46');
/*!40000 ALTER TABLE `saas_members` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_notification_outbox`
--

DROP TABLE IF EXISTS `saas_notification_outbox`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_notification_outbox` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `member_id` bigint(20) DEFAULT NULL,
  `event` varchar(40) NOT NULL,
  `title` varchar(80) DEFAULT NULL,
  `template_id` varchar(128) DEFAULT NULL,
  `page` varchar(200) DEFAULT NULL,
  `payload_json` text,
  `status` varchar(24) NOT NULL,
  `attempts` int(11) NOT NULL DEFAULT '0',
  `next_attempt_at` timestamp NULL DEFAULT NULL,
  `error` varchar(500) DEFAULT NULL,
  `sent_at` timestamp NULL DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_outbox_tenant_status` (`tenant_id`,`status`,`next_attempt_at`),
  CONSTRAINT `fk_outbox_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_notification_outbox`
--

LOCK TABLES `saas_notification_outbox` WRITE;
/*!40000 ALTER TABLE `saas_notification_outbox` DISABLE KEYS */;
INSERT INTO `saas_notification_outbox` VALUES (1,1,4,'test','订阅消息测试','tmpl-order-paid','pages/orders/orders','{\"thing1\":{\"value\":\"MySQL测试\"}}','MOCKED',1,NULL,NULL,'2026-11-26 08:46:04','2026-11-26 08:46:04');
/*!40000 ALTER TABLE `saas_notification_outbox` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_order_items`
--

DROP TABLE IF EXISTS `saas_order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_order_items` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `order_id` bigint(20) NOT NULL,
  `product_id` bigint(20) NOT NULL,
  `product_name` varchar(80) NOT NULL,
  `unit_price_cent` bigint(20) NOT NULL,
  `quantity` int(11) NOT NULL,
  `subtotal_cent` bigint(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_order_items_order` (`order_id`),
  KEY `fk_order_items_product` (`product_id`),
  CONSTRAINT `fk_order_items_order` FOREIGN KEY (`order_id`) REFERENCES `saas_orders` (`id`),
  CONSTRAINT `fk_order_items_product` FOREIGN KEY (`product_id`) REFERENCES `saas_products` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_order_items`
--

LOCK TABLES `saas_order_items` WRITE;
/*!40000 ALTER TABLE `saas_order_items` DISABLE KEYS */;
INSERT INTO `saas_order_items` VALUES (1,1,1,'有机小青菜',1280,1,1280),(2,2,2,'散养土鸡蛋',2980,1,2980),(3,3,1,'有机小青菜',1280,1,1280);
/*!40000 ALTER TABLE `saas_order_items` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_order_refunds`
--

DROP TABLE IF EXISTS `saas_order_refunds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_order_refunds` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `order_id` bigint(20) NOT NULL,
  `order_no` varchar(40) NOT NULL,
  `refund_no` varchar(48) NOT NULL,
  `amount_cent` bigint(20) NOT NULL,
  `reason` varchar(200) NOT NULL,
  `status` varchar(24) NOT NULL,
  `idempotency_key` varchar(96) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_refund_idempotency` (`tenant_id`,`idempotency_key`),
  KEY `fk_refund_order` (`order_id`),
  KEY `idx_refunds_tenant_order` (`tenant_id`,`order_id`,`created_at`),
  CONSTRAINT `fk_refund_order` FOREIGN KEY (`order_id`) REFERENCES `saas_orders` (`id`),
  CONSTRAINT `fk_refund_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_order_refunds`
--

LOCK TABLES `saas_order_refunds` WRITE;
/*!40000 ALTER TABLE `saas_order_refunds` DISABLE KEYS */;
INSERT INTO `saas_order_refunds` VALUES (1,1,2,'NT202611270002','RF202611270002F8B8FFB8',2980,'用户申请退款','SUCCESS','mysql-refund-003','2026-11-26 08:28:30');
/*!40000 ALTER TABLE `saas_order_refunds` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_orders`
--

DROP TABLE IF EXISTS `saas_orders`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_orders` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `member_id` bigint(20) NOT NULL,
  `order_no` varchar(40) NOT NULL,
  `status` varchar(24) NOT NULL,
  `payment_mode` varchar(24) NOT NULL,
  `goods_amount_cent` bigint(20) NOT NULL,
  `pay_amount_cent` bigint(20) NOT NULL,
  `remark` varchar(200) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` timestamp NULL DEFAULT NULL,
  `cancelled_at` timestamp NULL DEFAULT NULL,
  `delivered_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `logistics_company` varchar(50) DEFAULT NULL,
  `logistics_no` varchar(64) DEFAULT NULL,
  `refunded_amount_cent` bigint(20) NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `order_no` (`order_no`),
  KEY `fk_orders_member` (`member_id`),
  KEY `idx_orders_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_orders_tenant_status` (`tenant_id`,`status`),
  CONSTRAINT `fk_orders_member` FOREIGN KEY (`member_id`) REFERENCES `saas_members` (`id`),
  CONSTRAINT `fk_orders_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_orders`
--

LOCK TABLES `saas_orders` WRITE;
/*!40000 ALTER TABLE `saas_orders` DISABLE KEYS */;
INSERT INTO `saas_orders` VALUES (1,1,1,'NT202611270001','PAID','MOCK',4260,4260,NULL,'2026-11-26 08:21:12','2026-11-26 08:21:12',NULL,NULL,NULL,NULL,NULL,0),(2,1,2,'NT202611270002','REFUNDED','MOCK',2980,2980,'MySQL 联调订单','2026-11-26 16:26:38','2026-11-26 08:26:47',NULL,'2026-11-26 08:26:47',NULL,'顺丰','SF-20261127',2980),(3,1,4,'NT1795711665872DFB34F','PAID','WECHAT',1280,1280,'微信下单联调','2026-11-26 08:47:46','2026-11-26 08:47:46',NULL,NULL,NULL,NULL,NULL,0);
/*!40000 ALTER TABLE `saas_orders` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_points_ledger`
--

DROP TABLE IF EXISTS `saas_points_ledger`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_points_ledger` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `member_id` bigint(20) NOT NULL,
  `change_amount` bigint(20) NOT NULL,
  `reason` varchar(200) NOT NULL,
  `ref_id` varchar(80) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_points_member` (`member_id`),
  KEY `idx_points_tenant_member` (`tenant_id`,`member_id`,`created_at`),
  CONSTRAINT `fk_points_member` FOREIGN KEY (`member_id`) REFERENCES `saas_members` (`id`),
  CONSTRAINT `fk_points_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=4 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_points_ledger`
--

LOCK TABLES `saas_points_ledger` WRITE;
/*!40000 ALTER TABLE `saas_points_ledger` DISABLE KEYS */;
INSERT INTO `saas_points_ledger` VALUES (1,1,2,29,'订单消费返积分','NT202611270002','2026-11-26 08:26:47'),(2,1,1,10,'联调补偿','admin-adjustment','2026-11-26 08:26:47'),(3,1,4,12,'订单消费返积分','NT1795711665872DFB34F','2026-11-26 08:47:46');
/*!40000 ALTER TABLE `saas_points_ledger` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_products`
--

DROP TABLE IF EXISTS `saas_products`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_products` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `category_id` bigint(20) DEFAULT NULL,
  `name` varchar(80) NOT NULL,
  `description` varchar(500) DEFAULT NULL,
  `image_url` varchar(500) DEFAULT NULL,
  `price_cent` bigint(20) NOT NULL,
  `original_price_cent` bigint(20) NOT NULL,
  `stock` int(11) NOT NULL DEFAULT '0',
  `sales` int(11) NOT NULL DEFAULT '0',
  `on_sale` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_products_category` (`category_id`),
  KEY `idx_products_tenant_created` (`tenant_id`,`created_at`),
  CONSTRAINT `fk_products_category` FOREIGN KEY (`category_id`) REFERENCES `saas_categories` (`id`),
  CONSTRAINT `fk_products_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_products`
--

LOCK TABLES `saas_products` WRITE;
/*!40000 ALTER TABLE `saas_products` DISABLE KEYS */;
INSERT INTO `saas_products` VALUES (1,1,1,'有机小青菜','当日采摘，社区直送',NULL,1280,1680,119,0,1,'2026-11-26 08:21:12','2026-11-26 08:47:46'),(2,1,1,'散养土鸡蛋','30枚装',NULL,2980,3580,81,0,1,'2026-11-26 08:21:12','2026-11-26 08:28:30'),(3,1,2,'五常香米','5kg 家庭装',NULL,4580,5280,60,0,1,'2026-11-26 08:21:12','2026-11-26 08:21:12'),(4,1,2,'竹浆抽纸','12包整箱',NULL,2380,2880,90,0,1,'2026-11-26 08:21:12','2026-11-26 08:21:12'),(5,1,NULL,'联调测试商品-已更新','MySQL业务闭环','',1300,1600,15,0,0,'2026-11-26 08:26:47','2026-11-26 08:30:48');
/*!40000 ALTER TABLE `saas_products` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_subscription_authorizations`
--

DROP TABLE IF EXISTS `saas_subscription_authorizations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_subscription_authorizations` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `member_id` bigint(20) NOT NULL,
  `decisions_json` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_sub_auth_tenant` (`tenant_id`),
  KEY `fk_sub_auth_member` (`member_id`),
  CONSTRAINT `fk_sub_auth_member` FOREIGN KEY (`member_id`) REFERENCES `saas_members` (`id`),
  CONSTRAINT `fk_sub_auth_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_subscription_authorizations`
--

LOCK TABLES `saas_subscription_authorizations` WRITE;
/*!40000 ALTER TABLE `saas_subscription_authorizations` DISABLE KEYS */;
/*!40000 ALTER TABLE `saas_subscription_authorizations` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_tenants`
--

DROP TABLE IF EXISTS `saas_tenants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_tenants` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `code` varchar(48) NOT NULL,
  `name` varchar(80) NOT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_tenants`
--

LOCK TABLES `saas_tenants` WRITE;
/*!40000 ALTER TABLE `saas_tenants` DISABLE KEYS */;
INSERT INTO `saas_tenants` VALUES (1,'t-default','邻里团示范社区','ACTIVE','2026-11-26 08:21:12','2026-11-26 08:21:12');
/*!40000 ALTER TABLE `saas_tenants` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `saas_users`
--

DROP TABLE IF EXISTS `saas_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `saas_users` (
  `id` bigint(20) NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint(20) NOT NULL,
  `username` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(80) NOT NULL,
  `role` varchar(24) NOT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'ACTIVE',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_users_tenant_username` (`tenant_id`,`username`),
  CONSTRAINT `fk_users_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `saas_tenants` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `saas_users`
--

LOCK TABLES `saas_users` WRITE;
/*!40000 ALTER TABLE `saas_users` DISABLE KEYS */;
INSERT INTO `saas_users` VALUES (1,1,'admin','$2a$10$Yx/VgAWO653TVq8G.9e10.Lj/ESG9kObBEx85oBhH4UlS6bpEB6uy','经营管理员','OWNER','ACTIVE','2026-11-26 08:21:12','2026-11-26 08:21:12');
/*!40000 ALTER TABLE `saas_users` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Dumping routines for database 'wechat_saas'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-11-27  1:35:22
