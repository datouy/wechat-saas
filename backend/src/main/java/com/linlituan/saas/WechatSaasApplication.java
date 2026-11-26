package com.linlituan.saas;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.security.servlet.UserDetailsServiceAutoConfiguration;

@SpringBootApplication(exclude = UserDetailsServiceAutoConfiguration.class)
public class WechatSaasApplication {
    public static void main(String[] args) {
        SpringApplication.run(WechatSaasApplication.class, args);
    }
}

