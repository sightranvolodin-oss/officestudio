let wasm_bindgen;
(function() {
    const __exports = {};
    let script_src;
    if (typeof document !== 'undefined' && document.currentScript !== null) {
        script_src = new URL(document.currentScript.src, location.href).toString();
    }
    let wasm = undefined;

    let cachedUint8ArrayMemory0 = null;

    function getUint8ArrayMemory0() {
        if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
            cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
        }
        return cachedUint8ArrayMemory0;
    }

    let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });

    cachedTextDecoder.decode();

    function decodeText(ptr, len) {
        return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
    }

    function getStringFromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return decodeText(ptr, len);
    }

    let cachedUint32ArrayMemory0 = null;

    function getUint32ArrayMemory0() {
        if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
            cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
        }
        return cachedUint32ArrayMemory0;
    }

    function getArrayU32FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
    }

    let WASM_VECTOR_LEN = 0;

    function passArray32ToWasm0(arg, malloc) {
        const ptr = malloc(arg.length * 4, 4) >>> 0;
        getUint32ArrayMemory0().set(arg, ptr / 4);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    }

    let cachedFloat64ArrayMemory0 = null;

    function getFloat64ArrayMemory0() {
        if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
            cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
        }
        return cachedFloat64ArrayMemory0;
    }

    function getArrayF64FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
    }

    const cachedTextEncoder = new TextEncoder();

    if (!('encodeInto' in cachedTextEncoder)) {
        cachedTextEncoder.encodeInto = function (arg, view) {
            const buf = cachedTextEncoder.encode(arg);
            view.set(buf);
            return {
                read: arg.length,
                written: buf.length
            };
        }
    }

    function passStringToWasm0(arg, malloc, realloc) {

        if (realloc === undefined) {
            const buf = cachedTextEncoder.encode(arg);
            const ptr = malloc(buf.length, 1) >>> 0;
            getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
            WASM_VECTOR_LEN = buf.length;
            return ptr;
        }

        let len = arg.length;
        let ptr = malloc(len, 1) >>> 0;

        const mem = getUint8ArrayMemory0();

        let offset = 0;

        for (; offset < len; offset++) {
            const code = arg.charCodeAt(offset);
            if (code > 0x7F) break;
            mem[ptr + offset] = code;
        }

        if (offset !== len) {
            if (offset !== 0) {
                arg = arg.slice(offset);
            }
            ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
            const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
            const ret = cachedTextEncoder.encodeInto(arg, view);

            offset += ret.written;
            ptr = realloc(ptr, len, offset, 1) >>> 0;
        }

        WASM_VECTOR_LEN = offset;
        return ptr;
    }

    function takeFromExternrefTable0(idx) {
        const value = wasm.__wbindgen_export_0.get(idx);
        wasm.__externref_table_dealloc(idx);
        return value;
    }

    function getArrayU8FromWasm0(ptr, len) {
        ptr = ptr >>> 0;
        return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
    }

    function passArray8ToWasm0(arg, malloc) {
        const ptr = malloc(arg.length * 1, 1) >>> 0;
        getUint8ArrayMemory0().set(arg, ptr / 1);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    }

    function passArrayF64ToWasm0(arg, malloc) {
        const ptr = malloc(arg.length * 8, 8) >>> 0;
        getFloat64ArrayMemory0().set(arg, ptr / 8);
        WASM_VECTOR_LEN = arg.length;
        return ptr;
    }

    const EngineFinalization = (typeof FinalizationRegistry === 'undefined')
        ? { register: () => {}, unregister: () => {} }
        : new FinalizationRegistry(ptr => wasm.__wbg_engine_free(ptr >>> 0, 1));

    class Engine {

        __destroy_into_raw() {
            const ptr = this.__wbg_ptr;
            this.__wbg_ptr = 0;
            EngineFinalization.unregister(this);
            return ptr;
        }

        free() {
            const ptr = this.__destroy_into_raw();
            wasm.__wbg_engine_free(ptr, 0);
        }
        /**
         * @param {number} kind
         * @returns {number}
         */
        base_total(kind) {
            const ret = wasm.engine_base_total(this.__wbg_ptr, kind);
            return ret >>> 0;
        }
        build_base() {
            wasm.engine_build_base(this.__wbg_ptr);
        }
        /**
         * @param {number} n
         */
        merge_last(n) {
            wasm.engine_merge_last(this.__wbg_ptr, n);
        }
        /**
         * name of the layer under the cursor, looking inside blocks ("" if nothing)
         * @param {number} x
         * @param {number} y
         * @param {number} tol
         * @returns {string}
         */
        pick_layer(x, y, tol) {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_pick_layer(this.__wbg_ptr, x, y, tol);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @returns {Uint32Array}
         */
        base_groups() {
            const ret = wasm.engine_base_groups(this.__wbg_ptr);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * @returns {string}
         */
        block_names() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_block_names(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @param {number} i
         */
        build_paper(i) {
            wasm.engine_build_paper(this.__wbg_ptr, i);
        }
        /**
         * @returns {number}
         */
        dirty_count() {
            const ret = wasm.engine_dirty_count(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * @param {number} i
         * @returns {string}
         */
        entity_json(i) {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_entity_json(this.__wbg_ptr, i);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * [x1, y1, x2, y2] of the given entities
         * @param {Uint32Array} ids
         * @returns {Float64Array}
         */
        ids_extents(ids) {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_ids_extents(this.__wbg_ptr, ptr0, len0);
            var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v2;
        }
        /**
         * @returns {string}
         */
        layers_json() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_layers_json(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @returns {Float64Array}
         */
        paper_texts() {
            const ret = wasm.engine_paper_texts(this.__wbg_ptr);
            var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v1;
        }
        /**
         * @param {number} kind
         * @returns {number}
         */
        paper_total(kind) {
            const ret = wasm.engine_paper_total(this.__wbg_ptr, kind);
            return ret >>> 0;
        }
        /**
         * summary of a selection for the properties panel
         * @param {Uint32Array} ids
         * @returns {string}
         */
        sel_summary(ids) {
            let deferred2_0;
            let deferred2_1;
            try {
                const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
                const len0 = WASM_VECTOR_LEN;
                const ret = wasm.engine_sel_summary(this.__wbg_ptr, ptr0, len0);
                deferred2_0 = ret[0];
                deferred2_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
        /**
         * @returns {Uint32Array}
         */
        take_hidden() {
            const ret = wasm.engine_take_hidden(this.__wbg_ptr);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * delete a layer together with its entities
         * @param {string} name
         * @returns {number}
         */
        delete_layer(name) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_delete_layer(this.__wbg_ptr, ptr0, len0);
            return ret >>> 0;
        }
        /**
         * layouts («Лист» tabs): [{name, w, h, vps: [{cx, cy, w, h, mx, my, vh, twist, on}]}]
         * @returns {string}
         */
        layouts_json() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_layouts_json(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        ov_chunk_col(i) {
            const ret = wasm.engine_ov_chunk_col(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        ov_chunk_lay(i) {
            const ret = wasm.engine_ov_chunk_lay(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        ov_chunk_pos(i) {
            const ret = wasm.engine_ov_chunk_pos(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @returns {Uint32Array}
         */
        paper_groups() {
            const ret = wasm.engine_paper_groups(this.__wbg_ptr);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * Free the CPU copy of the base buffers after they were uploaded to the GPU
         */
        release_base() {
            wasm.engine_release_base(this.__wbg_ptr);
        }
        /**
         * @param {string} old
         * @param {string} _new
         * @returns {boolean}
         */
        rename_layer(old, _new) {
            const ptr0 = passStringToWasm0(old, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(_new, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.engine_rename_layer(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            return ret !== 0;
        }
        /**
         * @param {number} i
         * @param {string} json
         */
        replace_json(i, json) {
            const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_replace_json(this.__wbg_ptr, i, ptr0, len0);
            if (ret[1]) {
                throw takeFromExternrefTable0(ret[0]);
            }
        }
        /**
         * "" = ByLayer
         * @param {Uint32Array} ids
         * @param {string} color
         */
        set_color_of(ids, color) {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(color, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            wasm.engine_set_color_of(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        }
        /**
         * @param {Uint32Array} ids
         * @param {string} layer
         */
        set_layer_of(ids, layer) {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(layer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            wasm.engine_set_layer_of(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        }
        /**
         * [x1, y1, x2, y2, number of far-away stray objects left out]
         * @param {boolean} visible_only
         * @returns {Float64Array}
         */
        view_extents(visible_only) {
            const ret = wasm.engine_view_extents(this.__wbg_ptr, visible_only);
            var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v1;
        }
        /**
         * @returns {number}
         */
        base_tris_len() {
            const ret = wasm.engine_base_tris_len(this.__wbg_ptr);
            return ret >>> 0;
        }
        build_overlay() {
            wasm.engine_build_overlay(this.__wbg_ptr);
        }
        /**
         * @param {Uint32Array} ids
         * @returns {string}
         */
        entities_json(ids) {
            let deferred2_0;
            let deferred2_1;
            try {
                const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
                const len0 = WASM_VECTOR_LEN;
                const ret = wasm.engine_entities_json(this.__wbg_ptr, ptr0, len0);
                deferred2_0 = ret[0];
                deferred2_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
            }
        }
        /**
         * [x1, y1, x2, y2] of the entities on a layer (empty if none)
         * @param {string} name
         * @returns {Float64Array}
         */
        layer_extents(name) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_layer_extents(this.__wbg_ptr, ptr0, len0);
            var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v2;
        }
        /**
         * @param {number} x
         * @param {number} y
         * @param {number} tol
         * @param {string} layer
         * @returns {number}
         */
        pick_on_layer(x, y, tol, layer) {
            const ptr0 = passStringToWasm0(layer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_pick_on_layer(this.__wbg_ptr, x, y, tol, ptr0, len0);
            return ret;
        }
        /**
         * @param {number} x1
         * @param {number} y1
         * @param {number} x2
         * @param {number} y2
         * @param {boolean} crossing
         * @returns {Uint32Array}
         */
        select_window(x1, y1, x2, y2, crossing) {
            const ret = wasm.engine_select_window(this.__wbg_ptr, x1, y1, x2, y2, crossing);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        base_chunk_col(i) {
            const ret = wasm.engine_base_chunk_col(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        base_chunk_lay(i) {
            const ret = wasm.engine_base_chunk_lay(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        base_chunk_pos(i) {
            const ret = wasm.engine_base_chunk_pos(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * line segments / triangles in the base buffers (for statistics)
         * @returns {number}
         */
        base_lines_len() {
            const ret = wasm.engine_base_lines_len(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * @param {string} name
         * @returns {number}
         */
        layer_count_of(name) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_layer_count_of(this.__wbg_ptr, ptr0, len0);
            return ret >>> 0;
        }
        /**
         * @param {string} name
         * @returns {Float64Array}
         */
        layer_segments(name) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_layer_segments(this.__wbg_ptr, ptr0, len0);
            var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v2;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        paper_chunk_col(i) {
            const ret = wasm.engine_paper_chunk_col(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        paper_chunk_lay(i) {
            const ret = wasm.engine_paper_chunk_lay(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @param {number} i
         * @returns {number}
         */
        paper_chunk_pos(i) {
            const ret = wasm.engine_paper_chunk_pos(this.__wbg_ptr, i);
            return ret >>> 0;
        }
        /**
         * @returns {string}
         */
        paper_texts_str() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_paper_texts_str(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @param {string} name
         * @param {string} color
         */
        set_layer_color(name, color) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(color, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            wasm.engine_set_layer_color(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        }
        /**
         * visibility is a view setting (not part of undo history)
         * @param {string} name
         * @param {boolean} visible
         */
        set_layer_visible(name, visible) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            wasm.engine_set_layer_visible(this.__wbg_ptr, ptr0, len0, visible);
        }
        constructor() {
            const ret = wasm.engine_new();
            this.__wbg_ptr = ret >>> 0;
            EngineFinalization.register(this, this.__wbg_ptr, this);
            return this;
        }
        /**
         * @param {number} x
         * @param {number} y
         * @param {number} tol
         * @returns {number}
         */
        pick(x, y, tol) {
            const ret = wasm.engine_pick(this.__wbg_ptr, x, y, tol);
            return ret;
        }
        /**
         * @returns {boolean}
         */
        redo() {
            const ret = wasm.engine_redo(this.__wbg_ptr);
            return ret !== 0;
        }
        /**
         * @param {number} x
         * @param {number} y
         * @param {number} tol
         * @param {Uint32Array} exclude
         * @returns {Float64Array}
         */
        snap(x, y, tol, exclude) {
            const ptr0 = passArray32ToWasm0(exclude, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_snap(this.__wbg_ptr, x, y, tol, ptr0, len0);
            var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v2;
        }
        /**
         * @returns {boolean}
         */
        undo() {
            const ret = wasm.engine_undo(this.__wbg_ptr);
            return ret !== 0;
        }
        /**
         * filter ids down to entities that still exist
         * @param {Uint32Array} ids
         * @returns {Uint32Array}
         */
        alive(ids) {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_alive(this.__wbg_ptr, ptr0, len0);
            var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v2;
        }
        /**
         * @returns {number}
         */
        count() {
            const ret = wasm.engine_count(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * @param {Uint32Array} ids
         */
        erase(ids) {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            wasm.engine_erase(this.__wbg_ptr, ptr0, len0);
        }
        /**
         * @returns {string}
         */
        stats() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_stats(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * @returns {Float64Array}
         */
        texts() {
            const ret = wasm.engine_texts(this.__wbg_ptr);
            var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v1;
        }
        /**
         * $INSUNITS of the drawing (4 = mm, 6 = m, 0 = not set)
         * @returns {number}
         */
        units() {
            const ret = wasm.engine_units(this.__wbg_ptr);
            return ret;
        }
        /**
         * @returns {Float64Array}
         */
        origin() {
            const ret = wasm.engine_origin(this.__wbg_ptr);
            var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v1;
        }
        /**
         * @returns {Uint8Array}
         */
        to_dxf() {
            const ret = wasm.engine_to_dxf(this.__wbg_ptr);
            var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
            return v1;
        }
        /**
         * @param {boolean} visible_only
         * @returns {Float64Array}
         */
        extents(visible_only) {
            const ret = wasm.engine_extents(this.__wbg_ptr, visible_only);
            var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
            return v1;
        }
        /**
         * @returns {number}
         */
        sel_len() {
            const ret = wasm.engine_sel_len(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * @returns {number}
         */
        sel_ptr() {
            const ret = wasm.engine_sel_ptr(this.__wbg_ptr);
            return ret >>> 0;
        }
        /**
         * add entities from a JSON array; returns their ids
         * @param {string} json
         * @returns {Uint32Array}
         */
        add_json(json) {
            const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_add_json(this.__wbg_ptr, ptr0, len0);
            if (ret[3]) {
                throw takeFromExternrefTable0(ret[2]);
            }
            var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v2;
        }
        /**
         * Load an ASCII DXF (DWG is converted to DXF before reaching here). Returns a JSON summary.
         * @param {Uint8Array} bytes
         * @returns {string}
         */
        load_dxf(bytes) {
            let deferred3_0;
            let deferred3_1;
            try {
                const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
                const len0 = WASM_VECTOR_LEN;
                const ret = wasm.engine_load_dxf(this.__wbg_ptr, ptr0, len0);
                var ptr2 = ret[0];
                var len2 = ret[1];
                if (ret[3]) {
                    ptr2 = 0; len2 = 0;
                    throw takeFromExternrefTable0(ret[2]);
                }
                deferred3_0 = ptr2;
                deferred3_1 = len2;
                return getStringFromWasm0(ptr2, len2);
            } finally {
                wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
            }
        }
        /**
         * @param {number} kind
         * @returns {number}
         */
        ov_total(kind) {
            const ret = wasm.engine_ov_total(this.__wbg_ptr, kind);
            return ret >>> 0;
        }
        /**
         * define a block (e.g. a dimension) — blocks are not removed by undo
         * @param {string} name
         * @param {number} base_x
         * @param {number} base_y
         * @param {string} json
         */
        add_block(name, base_x, base_y, json) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.engine_add_block(this.__wbg_ptr, ptr0, len0, base_x, base_y, ptr1, len1);
            if (ret[1]) {
                throw takeFromExternrefTable0(ret[0]);
            }
        }
        /**
         * @param {string} name
         * @param {string} color
         * @returns {boolean}
         */
        add_layer(name, color) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(color, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.engine_add_layer(this.__wbg_ptr, ptr0, len0, ptr1, len1);
            return ret !== 0;
        }
        /**
         * selection outline geometry; returns segment count
         * @param {Uint32Array} ids
         * @param {number} max_segments
         * @returns {number}
         */
        build_sel(ids, max_segments) {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_build_sel(this.__wbg_ptr, ptr0, len0, max_segments);
            return ret >>> 0;
        }
        /**
         * @returns {number}
         */
        chord_tol() {
            const ret = wasm.engine_chord_tol(this.__wbg_ptr);
            return ret;
        }
        /**
         * @param {string} name
         * @returns {boolean}
         */
        has_block(name) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_has_block(this.__wbg_ptr, ptr0, len0);
            return ret !== 0;
        }
        /**
         * ids of the live entities on a layer
         * @param {string} name
         * @returns {Uint32Array}
         */
        layer_ids(name) {
            const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len0 = WASM_VECTOR_LEN;
            const ret = wasm.engine_layer_ids(this.__wbg_ptr, ptr0, len0);
            var v2 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v2;
        }
        /**
         * @returns {Uint32Array}
         */
        ov_groups() {
            const ret = wasm.engine_ov_groups(this.__wbg_ptr);
            var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v1;
        }
        /**
         * @returns {string}
         */
        texts_str() {
            let deferred1_0;
            let deferred1_1;
            try {
                const ret = wasm.engine_texts_str(this.__wbg_ptr);
                deferred1_0 = ret[0];
                deferred1_1 = ret[1];
                return getStringFromWasm0(ret[0], ret[1]);
            } finally {
                wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
            }
        }
        /**
         * apply a similarity transform [a,b,c,d,e,f]; with copy=true new entities are created. Returns resulting ids.
         * @param {Uint32Array} ids
         * @param {Float64Array} m
         * @param {boolean} copy
         * @returns {Uint32Array}
         */
        transform(ids, m, copy) {
            const ptr0 = passArray32ToWasm0(ids, wasm.__wbindgen_malloc);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passArrayF64ToWasm0(m, wasm.__wbindgen_malloc);
            const len1 = WASM_VECTOR_LEN;
            const ret = wasm.engine_transform(this.__wbg_ptr, ptr0, len0, ptr1, len1, copy);
            var v3 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
            return v3;
        }
    }
    if (Symbol.dispose) Engine.prototype[Symbol.dispose] = Engine.prototype.free;

    __exports.Engine = Engine;

    const EXPECTED_RESPONSE_TYPES = new Set(['basic', 'cors', 'default']);

    async function __wbg_load(module, imports) {
        if (typeof Response === 'function' && module instanceof Response) {
            if (typeof WebAssembly.instantiateStreaming === 'function') {
                try {
                    return await WebAssembly.instantiateStreaming(module, imports);

                } catch (e) {
                    const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);

                    if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                        console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                    } else {
                        throw e;
                    }
                }
            }

            const bytes = await module.arrayBuffer();
            return await WebAssembly.instantiate(bytes, imports);

        } else {
            const instance = await WebAssembly.instantiate(module, imports);

            if (instance instanceof WebAssembly.Instance) {
                return { instance, module };

            } else {
                return instance;
            }
        }
    }

    function __wbg_get_imports() {
        const imports = {};
        imports.wbg = {};
        imports.wbg.__wbg_wbindgenthrow_451ec1a8469d7eb6 = function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        };
        imports.wbg.__wbindgen_cast_2241b6af4c4b2941 = function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        };
        imports.wbg.__wbindgen_init_externref_table = function() {
            const table = wasm.__wbindgen_export_0;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
            ;
        };

        return imports;
    }

    function __wbg_init_memory(imports, memory) {

    }

    function __wbg_finalize_init(instance, module) {
        wasm = instance.exports;
        __wbg_init.__wbindgen_wasm_module = module;
        cachedFloat64ArrayMemory0 = null;
        cachedUint32ArrayMemory0 = null;
        cachedUint8ArrayMemory0 = null;


        wasm.__wbindgen_start();
        return wasm;
    }

    function initSync(module) {
        if (wasm !== undefined) return wasm;


        if (typeof module !== 'undefined') {
            if (Object.getPrototypeOf(module) === Object.prototype) {
                ({module} = module)
            } else {
                console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
            }
        }

        const imports = __wbg_get_imports();

        __wbg_init_memory(imports);

        if (!(module instanceof WebAssembly.Module)) {
            module = new WebAssembly.Module(module);
        }

        const instance = new WebAssembly.Instance(module, imports);

        return __wbg_finalize_init(instance, module);
    }

    async function __wbg_init(module_or_path) {
        if (wasm !== undefined) return wasm;


        if (typeof module_or_path !== 'undefined') {
            if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
                ({module_or_path} = module_or_path)
            } else {
                console.warn('using deprecated parameters for the initialization function; pass a single object instead')
            }
        }

        if (typeof module_or_path === 'undefined' && typeof script_src !== 'undefined') {
            module_or_path = script_src.replace(/\.js$/, '_bg.wasm');
        }
        const imports = __wbg_get_imports();

        if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
            module_or_path = fetch(module_or_path);
        }

        __wbg_init_memory(imports);

        const { instance, module } = await __wbg_load(await module_or_path, imports);

        return __wbg_finalize_init(instance, module);
    }

    wasm_bindgen = Object.assign(__wbg_init, { initSync }, __exports);

})();
