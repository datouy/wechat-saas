package com.linlituan.saas.config;

import com.linlituan.saas.auth.UserAccount;
import com.linlituan.saas.auth.UserAccountRepository;
import com.linlituan.saas.member.Member;
import com.linlituan.saas.member.MemberRepository;
import com.linlituan.saas.order.Order;
import com.linlituan.saas.order.OrderItem;
import com.linlituan.saas.order.OrderItemRepository;
import com.linlituan.saas.order.OrderRepository;
import com.linlituan.saas.product.Product;
import com.linlituan.saas.product.ProductCategory;
import com.linlituan.saas.product.ProductCategoryRepository;
import com.linlituan.saas.product.ProductRepository;
import com.linlituan.saas.tenant.Tenant;
import com.linlituan.saas.tenant.TenantRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Component
public class DataBootstrap implements ApplicationRunner {
    private final Environment environment;
    private final TenantRepository tenants;
    private final UserAccountRepository users;
    private final MemberRepository members;
    private final ProductCategoryRepository categories;
    private final ProductRepository products;
    private final OrderRepository orders;
    private final OrderItemRepository orderItems;
    private final PasswordEncoder passwordEncoder;

    public DataBootstrap(Environment environment, TenantRepository tenants, UserAccountRepository users,
                         MemberRepository members, ProductCategoryRepository categories, ProductRepository products,
                         OrderRepository orders, OrderItemRepository orderItems, PasswordEncoder passwordEncoder) {
        this.environment = environment;
        this.tenants = tenants;
        this.users = users;
        this.members = members;
        this.categories = categories;
        this.products = products;
        this.orders = orders;
        this.orderItems = orderItems;
        this.passwordEncoder = passwordEncoder;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (!environment.getProperty("app.seed.enabled", Boolean.class, true) || tenants.count() > 0) {
            return;
        }
        Tenant tenant = new Tenant();
        tenant.setCode("t-default");
        tenant.setName("邻里团示范社区");
        tenant.setStatus("ACTIVE");
        tenants.save(tenant);

        UserAccount admin = new UserAccount();
        admin.setTenantId(tenant.getId());
        admin.setUsername("admin");
        admin.setDisplayName("经营管理员");
        admin.setRole("OWNER");
        admin.setStatus("ACTIVE");
        admin.setPasswordHash(passwordEncoder.encode("admin123"));
        users.save(admin);

        ProductCategory vegetables = new ProductCategory();
        vegetables.setTenantId(tenant.getId());
        vegetables.setName("生鲜蔬果");
        vegetables.setSortOrder(1);
        categories.save(vegetables);

        ProductCategory daily = new ProductCategory();
        daily.setTenantId(tenant.getId());
        daily.setName("社区日用");
        daily.setSortOrder(2);
        categories.save(daily);

        Product greens = product(tenant.getId(), vegetables.getId(), "有机小青菜", "当日采摘，社区直送", 1280L, 1680L, 120);
        Product eggs = product(tenant.getId(), vegetables.getId(), "散养土鸡蛋", "30枚装", 2980L, 3580L, 80);
        Product rice = product(tenant.getId(), daily.getId(), "五常香米", "5kg 家庭装", 4580L, 5280L, 60);
        Product tissue = product(tenant.getId(), daily.getId(), "竹浆抽纸", "12包整箱", 2380L, 2880L, 90);
        products.saveAll(List.of(greens, eggs, rice, tissue));

        Member m1 = member(tenant.getId(), "mock-openid-1", "林女士", "13800000001", 120, 12800L, 2);
        Member m2 = member(tenant.getId(), "mock-openid-2", "周先生", "13800000002", 60, 6380L, 1);
        Member m3 = member(tenant.getId(), "mock-openid-3", "陈阿姨", "13800000003", 210, 18600L, 3);
        members.saveAll(List.of(m1, m2, m3));

        Order order = new Order();
        order.setTenantId(tenant.getId());
        order.setMemberId(m1.getId());
        order.setOrderNo("NT202611270001");
        order.setStatus("PAID");
        order.setPaymentMode("MOCK");
        order.setGoodsAmountCent(4260L);
        order.setPayAmountCent(4260L);
        order.setPaidAt(Instant.now());
        orders.save(order);

        OrderItem item = new OrderItem();
        item.setOrderId(order.getId());
        item.setProductId(greens.getId());
        item.setProductName(greens.getName());
        item.setUnitPriceCent(greens.getPriceCent());
        item.setQuantity(1);
        item.setSubtotalCent(greens.getPriceCent());
        orderItems.save(item);

        Order pending = new Order();
        pending.setTenantId(tenant.getId());
        pending.setMemberId(m2.getId());
        pending.setOrderNo("NT202611270002");
        pending.setStatus("PENDING");
        pending.setPaymentMode("MOCK");
        pending.setGoodsAmountCent(2980L);
        pending.setPayAmountCent(2980L);
        orders.save(pending);

        OrderItem pendingItem = new OrderItem();
        pendingItem.setOrderId(pending.getId());
        pendingItem.setProductId(eggs.getId());
        pendingItem.setProductName(eggs.getName());
        pendingItem.setUnitPriceCent(eggs.getPriceCent());
        pendingItem.setQuantity(1);
        pendingItem.setSubtotalCent(eggs.getPriceCent());
        orderItems.save(pendingItem);
    }

    private Product product(Long tenantId, Long categoryId, String name, String description,
                            Long priceCent, Long originalPriceCent, int stock) {
        Product product = new Product();
        product.setTenantId(tenantId);
        product.setCategoryId(categoryId);
        product.setName(name);
        product.setDescription(description);
        product.setPriceCent(priceCent);
        product.setOriginalPriceCent(originalPriceCent);
        product.setStock(stock);
        product.setSales(0);
        product.setOnSale(true);
        return product;
    }

    private Member member(Long tenantId, String openid, String nickname, String phone,
                          long points, long spent, int orderCount) {
        Member member = new Member();
        member.setTenantId(tenantId);
        member.setOpenid(openid);
        member.setNickname(nickname);
        member.setPhone(phone);
        member.setPoints(points);
        member.setTotalSpentCent(spent);
        member.setOrderCount(orderCount);
        return member;
    }
}

