package com.linlituan.saas.form;

import com.linlituan.saas.common.ApiResponse;
import com.linlituan.saas.security.TenantContext;
import jakarta.validation.Valid;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/forms")
@PreAuthorize("hasAnyRole('OWNER','MANAGER')")
public class FormController {
    private final FormService service;

    public FormController(FormService service) {
        this.service = service;
    }

    @GetMapping
    public ApiResponse<List<FormDtos.FormView>> list() {
        return ApiResponse.ok(service.list(TenantContext.require().tenantId()).stream().map(service::view).toList());
    }

    @PostMapping
    public ApiResponse<FormDtos.FormView> create(@Valid @RequestBody FormDtos.CreateRequest request) {
        return ApiResponse.ok(service.view(service.create(TenantContext.require().tenantId(), request)));
    }

    @PutMapping("/{id}")
    public ApiResponse<FormDtos.FormView> update(@PathVariable Long id,
                                                 @RequestBody FormDtos.UpdateRequest request) {
        return ApiResponse.ok(service.view(service.update(TenantContext.require().tenantId(), id, request)));
    }

    @GetMapping("/{id}/stats")
    public ApiResponse<FormDtos.StatsView> stats(@PathVariable Long id) {
        return ApiResponse.ok(service.stats(TenantContext.require().tenantId(), id));
    }
}

