"""Convert the official Real-ESRGAN `realesr-general-x4v3.pth` to ONNX, without PyTorch.

Usage (Python 3.10+, `pip install onnx numpy`; `onnxruntime` optional for the check):

    python -I convert_model.py realesr-general-x4v3.pth ../models/realesr-general-x4v3.onnx [--fp16-weights] [--static HxW]

--fp16-weights stores the weights as float16 (half the file size) and adds Cast nodes so the graph
still computes in float32; onnxruntime constant-folds those casts when the session is created.
--static HxW fixes the input shape (the WebGL backend cannot take symbolic dimensions or float16).

The .pth is a PyTorch zip checkpoint holding {'params': state_dict} for
SRVGGNetCompact(num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4, act_type='prelu')
(see realesrgan/archs/srvgg_arch.py in xinntao/Real-ESRGAN). We read the tensors with a tiny
restricted unpickler (no torch, no arbitrary code) and write the same graph with onnx.helper:

    x -> Conv(3->64) -> PReLU -> 32 x [Conv(64->64) -> PReLU] -> Conv(64->48)
      + Conv1x1(x, repeat each channel 16x)       (== nearest x4 upsample after the shuffle)
      -> DepthToSpace(4, CRD)                      (== torch PixelShuffle)
    -> output

Input  "input":  float32 [1, 3, H, W], RGB in 0..1
Output "output": float32 [1, 3, 4H, 4W], RGB, roughly 0..1 (clamp it)

With onnxruntime installed, the script checks the ONNX graph against a plain NumPy
implementation of the same forward pass on a random image.
"""
import pickle
import sys
import zipfile

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper

DTYPES = {
    "FloatStorage": np.float32,
    "HalfStorage": np.float16,
    "DoubleStorage": np.float64,
    "LongStorage": np.int64,
    "IntStorage": np.int32,
}


class _Storage:
    def __init__(self, dtype, key):
        self.dtype, self.key = dtype, key


class _StorageType:
    def __init__(self, name):
        self.name = name


def load_pth(path):
    """Read a torch zip checkpoint into {name: np.ndarray} without importing torch."""
    zf = zipfile.ZipFile(path)
    names = zf.namelist()
    pkl = next(n for n in names if n.endswith("data.pkl"))
    root = pkl[: -len("data.pkl")]

    def rebuild_tensor(storage, offset, size, stride, *_):
        raw = zf.read(f"{root}data/{storage.key}")
        flat = np.frombuffer(raw, dtype=storage.dtype)
        itemsize = flat.itemsize
        arr = np.lib.stride_tricks.as_strided(
            flat[offset:], shape=tuple(size), strides=tuple(s * itemsize for s in stride)
        )
        return np.array(arr)  # copy, contiguous

    class Unpickler(pickle.Unpickler):
        def find_class(self, module, name):
            if module == "torch._utils" and name == "_rebuild_tensor_v2":
                return rebuild_tensor
            if module == "torch" and name in DTYPES:
                return _StorageType(name)
            if module == "collections" and name == "OrderedDict":
                import collections

                return collections.OrderedDict
            raise pickle.UnpicklingError(f"refusing to load {module}.{name}")

        def persistent_load(self, pid):
            # ('storage', storage_type, key, location, numel)
            _, stype, key, _loc, _numel = pid
            return _Storage(DTYPES[stype.name], key)

    with zf.open(pkl) as f:
        obj = Unpickler(f).load()
    return obj.get("params_ema") or obj.get("params") or obj


def build_onnx(sd, fp16_weights=False, static=None):
    convs = sorted({int(k.split(".")[1]) for k in sd if k.endswith(".weight") and sd[k].ndim == 4})
    prelus = sorted({int(k.split(".")[1]) for k in sd if k.endswith(".weight") and sd[k].ndim == 1})
    assert convs[0] == 0 and len(convs) == len(prelus) + 1, (convs, prelus)
    scale = int(round((sd[f"body.{convs[-1]}.weight"].shape[0] // 3) ** 0.5))

    inits, nodes = [], []

    def weight(arr, name):
        if not fp16_weights:
            inits.append(numpy_helper.from_array(arr.astype(np.float32), name))
            return name
        inits.append(numpy_helper.from_array(arr.astype(np.float16), name + "_f16"))
        nodes.append(helper.make_node("Cast", [name + "_f16"], [name], to=TensorProto.FLOAT))
        return name

    cur = "input"
    for idx in range(convs[-1] + 1):
        w = sd[f"body.{idx}.weight"].astype(np.float32)
        out = f"t{idx}"
        if idx in convs:
            b = sd[f"body.{idx}.bias"].astype(np.float32)
            wn, bn = weight(w, f"body.{idx}.weight"), weight(b, f"body.{idx}.bias")
            nodes.append(helper.make_node("Conv", [cur, wn, bn], [out],
                                          kernel_shape=[3, 3], pads=[1, 1, 1, 1], strides=[1, 1]))
        else:
            nodes.append(helper.make_node("PRelu", [cur, weight(w.reshape(-1, 1, 1), f"body.{idx}.weight")], [out]))
        cur = out

    # Nearest x4 upsampling of the input, written as a 1x1 conv that repeats each input channel
    # scale^2 times, added before the shuffle. It equals torch's F.interpolate(nearest) + add, and
    # avoids Resize, which the WebGL backend cannot run in packed mode.
    rep = np.zeros((3 * scale * scale, 3, 1, 1), dtype=np.float32)
    for c in range(3):
        rep[c * scale * scale:(c + 1) * scale * scale, c] = 1
    inits.append(numpy_helper.from_array(rep, "base_repeat"))
    nodes.append(helper.make_node("Conv", ["input", "base_repeat"], ["base"], kernel_shape=[1, 1]))
    nodes.append(helper.make_node("Add", [cur, "base"], ["summed"]))
    nodes.append(helper.make_node("DepthToSpace", ["summed"], ["output"], blocksize=scale, mode="CRD"))

    h, w = static or ("height", "width")
    oh, ow = (h * scale, w * scale) if static else ("out_height", "out_width")
    graph = helper.make_graph(
        nodes, "realesr_general_x4v3",
        [helper.make_tensor_value_info("input", TensorProto.FLOAT, [1, 3, h, w])],
        [helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, oh, ow])],
        inits,
    )
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="pinch-convert")
    model.ir_version = 8
    model.doc_string = ("Real-ESRGAN realesr-general-x4v3 (SRVGGNetCompact), BSD-3-Clause, "
                        "converted from the official v0.2.5.0 release .pth")
    onnx.checker.check_model(model)
    return model, scale


def numpy_forward(sd, x, scale):
    def conv(t, w, b):
        c, h, wd = t.shape
        p = np.pad(t, ((0, 0), (1, 1), (1, 1)))
        cols = np.stack([p[:, i:i + h, j:j + wd] for i in range(3) for j in range(3)], 1)  # c,9,h,w
        return np.einsum("ock,ckhw->ohw", w.reshape(w.shape[0], c, 9), cols) + b[:, None, None]

    t = x
    n = max(int(k.split(".")[1]) for k in sd) + 1
    for idx in range(n):
        w = sd[f"body.{idx}.weight"]
        if w.ndim == 4:
            t = conv(t, w, sd[f"body.{idx}.bias"])
        else:
            t = np.where(t >= 0, t, t * w[:, None, None])
    c, h, wd = t.shape
    co = c // (scale * scale)
    out = t.reshape(co, scale, scale, h, wd).transpose(0, 3, 1, 4, 2).reshape(co, h * scale, wd * scale)
    return out + np.repeat(np.repeat(x, scale, 1), scale, 2)


def main():
    src, dst = sys.argv[1], sys.argv[2]
    sd = load_pth(src)
    fp16 = "--fp16-weights" in sys.argv[3:]
    static = None
    if "--static" in sys.argv[3:]:
        h, w = sys.argv[sys.argv.index("--static") + 1].lower().split("x")
        static = (int(h), int(w))
    model, scale = build_onnx(sd, fp16, static)
    onnx.save(model, dst)
    print(f"wrote {dst} (x{scale}, {len(sd)} tensors, {'float16' if fp16 else 'float32'} weights)")
    try:
        import onnxruntime as ort
    except ImportError:
        print("onnxruntime not installed; skipped the numerical check")
        return
    rng = np.random.default_rng(0)
    x = rng.random((3,) + (static or (24, 20)), dtype=np.float32)
    got = ort.InferenceSession(dst, providers=["CPUExecutionProvider"]).run(None, {"input": x[None]})[0][0]
    ref = numpy_forward({k: v.astype(np.float64) for k, v in sd.items()}, x.astype(np.float64), scale)
    print(f"check: output {got.shape}, max abs diff vs NumPy reference {np.abs(got - ref).max():.2e}")
    assert got.shape == (3, x.shape[1] * scale, x.shape[2] * scale) and np.abs(got - ref).max() < (2e-2 if fp16 else 1e-3)


if __name__ == "__main__":
    main()
