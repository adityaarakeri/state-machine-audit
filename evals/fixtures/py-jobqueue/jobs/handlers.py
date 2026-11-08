def resize_image(payload):
    return payload


def export_csv(payload):
    return payload


HANDLERS = {
    "resize_image": resize_image,
    "export_csv": export_csv,
}
