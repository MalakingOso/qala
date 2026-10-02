package com.qala.data.sync

/**
 * The synced record types. The wire name is what the outbox and the future sync endpoint carry, and the
 * Room table name of the type's main table.
 */
enum class RecordType(val wire: String) {
    LIFT_SESSION("lift_session"),
    RUN_SESSION("run_session"),
    CHECK_IN("check_in"),
    BODY_WEIGHT("body_weight"),
    DAY_SKIP("day_skip"),
    AVAILABILITY("availability"),
    SETTINGS("settings"),
    PROGRAM("program"),
    ;

    companion object {
        fun fromWire(wire: String): RecordType? = entries.firstOrNull { it.wire == wire }
    }
}
