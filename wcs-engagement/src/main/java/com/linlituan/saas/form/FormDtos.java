package com.linlituan.saas.form;

import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;
import java.util.Map;

public final class FormDtos {
    private FormDtos() {
    }

    public record FieldDefinition(String id, @NotBlank(message = "字段名不能为空") String label,
                                  String type, List<String> options, boolean required) {
    }

    public record CreateRequest(@NotBlank(message = "表单标题不能为空") String title,
                                String description, List<FieldDefinition> fields, String status) {
    }

    public record UpdateRequest(String title, String description, List<FieldDefinition> fields, String status) {
    }

    public record SubmitRequest(Map<String, Object> answers) {
    }

    public record FormView(Long id, String title, String description, List<FieldDefinition> fields,
                           String status, Instant createdAt) {
    }

    public record FieldStats(String id, String label, String type, Map<String, Long> distribution,
                             Double average, long answered) {
    }

    public record StatsView(Long formId, String title, long total, List<FieldStats> fields) {
    }
}

