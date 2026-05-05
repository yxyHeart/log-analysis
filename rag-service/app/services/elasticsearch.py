INDEX_NAME = "logscope_kb"

INDEX_MAPPING = {
    "settings": {
        "number_of_shards": 1,
        "number_of_replicas": 0,
    },
    "mappings": {
        "properties": {
            "chunk_text": {
                "type": "text",
                "analyzer": "standard",
                "fields": {
                    "keyword": {"type": "keyword", "ignore_above": 256},
                },
            },
            "embedding": {
                "type": "dense_vector",
                "dims": 384,
                "index": True,
                "similarity": "cosine",
            },
            "doc_id": {"type": "keyword"},
            "source": {"type": "keyword"},
            "source_type": {"type": "keyword"},
            "chunk_index": {"type": "integer"},
            "upload_date": {"type": "date"},
            # Root cause analysis metadata
            "semantic_summary": {"type": "text", "analyzer": "standard"},
            "root_cause_category": {"type": "keyword"},
            "affected_services": {"type": "keyword"},
            "error_type": {"type": "keyword"},
            "severity": {"type": "keyword"},
            "call_chain": {"type": "keyword"},
            "stack_trace_present": {"type": "boolean"},
            "resolution_status": {"type": "keyword"},
        },
    },
}
