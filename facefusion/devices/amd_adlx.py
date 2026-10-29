import ctypes
import ctypes.wintypes
import threading
from typing import List, Optional

from facefusion.libraries import amd_adlx as amd_adlx_module

_LOCK = threading.RLock()
_CACHED_SESSION = ctypes.c_void_p()
_ADLX_FAILED = False


class _FallbackMemory(ctypes.Structure):
	_fields_ =\
	[
		('memory_total', ctypes.c_int),
		('memory_used', ctypes.c_int)
	]


# ── Built-in Windows ADL2 / WMI / Counter Fallback (when ADLX DLL crashes) ──
class _ADLAdapterInfo(ctypes.Structure):
	_fields_ =\
	[
		('Size', ctypes.c_int),
		('AdapterIndex', ctypes.c_int),
		('UDID', ctypes.c_char * 256),
		('BusNumber', ctypes.c_int),
		('DeviceNumber', ctypes.c_int),
		('FunctionNumber', ctypes.c_int),
		('VendorID', ctypes.c_int),
		('AdapterName', ctypes.c_char * 256),
		('DisplayName', ctypes.c_char * 256),
		('Present', ctypes.c_int),
		('Exist', ctypes.c_int),
		('DriverPath', ctypes.c_char * 256),
		('DriverPathExt', ctypes.c_char * 256),
		('PNPString', ctypes.c_char * 256),
		('OSDisplayIndex', ctypes.c_int)
	]


class _ADLPMActivity(ctypes.Structure):
	_fields_ =\
	[
		('Size', ctypes.c_int),
		('EngineClock', ctypes.c_int),
		('MemoryClock', ctypes.c_int),
		('Vddc', ctypes.c_int),
		('ActivityPercent', ctypes.c_int),
		('CurrentPerformanceLevel', ctypes.c_int),
		('CurrentBusSpeed', ctypes.c_int),
		('CurrentBusLanes', ctypes.c_int),
		('MaximumBusLanes', ctypes.c_int),
		('Reserved', ctypes.c_int)
	]


class _ADLTemperature(ctypes.Structure):
	_fields_ =\
	[
		('Size', ctypes.c_int),
		('Temperature', ctypes.c_int)
	]


class _ADLMemoryInfo(ctypes.Structure):
	_fields_ =\
	[
		('MemorySize', ctypes.c_longlong),
		('MemoryType', ctypes.c_char * 256),
		('MemoryBandwidth', ctypes.c_longlong)
	]


_ADL_ALLOC_FUNC = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_int)
_msvcrt = ctypes.cdll.msvcrt
_msvcrt.malloc.restype = ctypes.c_void_p
_msvcrt.malloc.argtypes = [ ctypes.c_size_t ]


@_ADL_ALLOC_FUNC
def _adl_malloc(size : int) -> int:
	return _msvcrt.malloc(size)


class _ADLBridge:
	lib : Optional[ctypes.CDLL] = None
	context = ctypes.c_void_p()
	adapter_index : int = 0
	adapter_name : bytes = b'AMD Radeon RX GPU'
	driver_ver : bytes = b'26.x'
	vram_total_mb : int = 16384
	initialized : bool = False

	@classmethod
	def ensure_init(cls) -> bool:
		if cls.initialized:
			return cls.lib is not None
		cls.initialized = True
		for dll_name in ('atiadlxx.dll', 'atiadlxy.dll'):
			try:
				cls.lib = ctypes.WinDLL(dll_name)
				break
			except OSError:
				cls.lib = None
		if not cls.lib:
			return False

		try:
			cls.lib.ADL2_Main_Control_Create.argtypes = [ _ADL_ALLOC_FUNC, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p) ]
			cls.lib.ADL2_Main_Control_Create.restype = ctypes.c_int
			if cls.lib.ADL2_Main_Control_Create(_adl_malloc, 1, ctypes.byref(cls.context)) != 0:
				cls.lib = None
				return False

			num_adapters = ctypes.c_int(0)
			cls.lib.ADL2_Adapter_NumberOfAdapters_Get(cls.context, ctypes.byref(num_adapters))
			if num_adapters.value > 0:
				infos = (_ADLAdapterInfo * num_adapters.value)()
				ctypes.memset(infos, 0, ctypes.sizeof(infos))
				for i in range(num_adapters.value):
					infos[i].Size = ctypes.sizeof(_ADLAdapterInfo)
				if cls.lib.ADL2_Adapter_AdapterInfo_Get(cls.context, infos, ctypes.sizeof(infos)) == 0:
					for info in infos:
						name = bytes(info.AdapterName).split(b'\x00', 1)[0].strip()
						if info.Present and info.VendorID in (1002, 0x1002) and name:
							cls.adapter_index = info.AdapterIndex
							cls.adapter_name = name
							break

			mem_info = _ADLMemoryInfo()
			if hasattr(cls.lib, 'ADL2_Adapter_MemoryInfo_Get'):
				if cls.lib.ADL2_Adapter_MemoryInfo_Get(cls.context, cls.adapter_index, ctypes.byref(mem_info)) == 0:
					if mem_info.MemorySize > 0:
						cls.vram_total_mb = int(mem_info.MemorySize // (1024 * 1024))
			return True
		except Exception:
			cls.lib = None
			return False

	@classmethod
	def get_utilization(cls) -> float:
		if not cls.ensure_init() or not cls.lib:
			return 0.0
		try:
			# Try ADL2 OverdriveN / Overdrive5 Activity
			act = _ADLPMActivity()
			act.Size = ctypes.sizeof(_ADLPMActivity)
			if cls.lib.ADL2_Overdrive5_CurrentActivity_Get(cls.context, cls.adapter_index, ctypes.byref(act)) == 0:
				return float(max(0, min(100, act.ActivityPercent)))
		except Exception:
			pass
		return 0.0

	@classmethod
	def get_temperature(cls) -> float:
		if not cls.ensure_init() or not cls.lib:
			return 0.0
		try:
			temp = _ADLTemperature()
			temp.Size = ctypes.sizeof(_ADLTemperature)
			if cls.lib.ADL2_Overdrive5_Temperature_Get(cls.context, cls.adapter_index, 0, ctypes.byref(temp)) == 0:
				return float(temp.Temperature / 1000.0) if temp.Temperature > 200 else float(temp.Temperature)
		except Exception:
			pass
		return 0.0

	@classmethod
	def get_vram_used_mb(cls) -> int:
		if not cls.ensure_init() or not cls.lib:
			return 0
		try:
			if hasattr(cls.lib, 'ADL2_Adapter_DedicatedVRAMUsage_Get'):
				used = ctypes.c_int(0)
				if cls.lib.ADL2_Adapter_DedicatedVRAMUsage_Get(cls.context, cls.adapter_index, ctypes.byref(used)) == 0:
					return max(0, int(used.value))
		except Exception:
			pass
		return 0


# Sentinel handle value when running in ADL fallback mode
_FALLBACK_SENTINEL = 0x7FFF0001


def _safe_lookup(handle : ctypes.c_void_p, index : int, restype : type, argtypes : List[type]):
	return amd_adlx_module.lookup_method(handle, index, restype, argtypes)


def init() -> ctypes.c_void_p:
	global _CACHED_SESSION, _ADLX_FAILED

	with _LOCK:
		if _CACHED_SESSION.value and not _ADLX_FAILED:
			return _CACHED_SESSION

		if not _ADLX_FAILED:
			try:
				amd_adlx_library = amd_adlx_module.create_static_library()
				if amd_adlx_library:
					full_version = ctypes.c_uint64()
					session_handle = ctypes.c_void_p()
					if amd_adlx_library.ADLXQueryFullVersion(ctypes.byref(full_version)) == 0:
						res = amd_adlx_library.ADLXInitialize(full_version.value, ctypes.byref(session_handle))
						if res == 0 and session_handle.value:
							_CACHED_SESSION = session_handle
							return _CACHED_SESSION
			except OSError:
				_ADLX_FAILED = True

		# Fallback to ADL2 if ADLX fails or crashes
		if _ADLBridge.ensure_init():
			return ctypes.c_void_p(_FALLBACK_SENTINEL)

		return ctypes.c_void_p()


def get_framework_version() -> ctypes.c_char_p:
	if not _ADLX_FAILED:
		try:
			amd_adlx_library = amd_adlx_module.create_static_library()
			framework_version = ctypes.c_char_p(bytes())
			if amd_adlx_library and amd_adlx_library.ADLXQueryVersion(ctypes.byref(framework_version)) == 0:
				if framework_version.value:
					return framework_version
		except OSError:
			pass
	return ctypes.c_char_p(b'1.0')


def find_device_handles(session_handle : ctypes.c_void_p) -> List[ctypes.c_void_p]:
	global _ADLX_FAILED

	if not session_handle or not session_handle.value:
		return []

	if session_handle.value == _FALLBACK_SENTINEL or _ADLX_FAILED:
		if _ADLBridge.ensure_init():
			return [ ctypes.c_void_p(_FALLBACK_SENTINEL) ]
		return []

	device_handles : List[ctypes.c_void_p] = []
	device_list_handle = ctypes.c_void_p()

	with _LOCK:
		try:
			get_gpus = _safe_lookup(session_handle, 1, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])
			if get_gpus(session_handle, ctypes.byref(device_list_handle)) == 0 and device_list_handle.value:
				get_size = _safe_lookup(device_list_handle, 3, ctypes.c_uint32, [ ctypes.c_void_p ])
				get_device = _safe_lookup(device_list_handle, 11, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_uint32, ctypes.c_void_p ])
				count = min(int(get_size(device_list_handle)), 16)

				for device_index in range(count):
					device_handle = ctypes.c_void_p()
					if get_device(device_list_handle, device_index, ctypes.byref(device_handle)) == 0 and device_handle.value:
						device_handles.append(device_handle)

				release(device_list_handle)
				return device_handles
		except OSError:
			# Access violation in amdadlx64.dll vtable: switch seamlessly to ADL2 fallback
			_ADLX_FAILED = True
			if _ADLBridge.ensure_init():
				return [ ctypes.c_void_p(_FALLBACK_SENTINEL) ]

	return device_handles


def get_driver_version(device_handle : ctypes.c_void_p) -> ctypes.c_char_p:
	if not device_handle or device_handle.value == _FALLBACK_SENTINEL or _ADLX_FAILED:
		return ctypes.c_char_p(_ADLBridge.driver_ver)

	driver_version = ctypes.c_char_p(bytes())
	device_interface_handle = ctypes.c_void_p()
	try:
		query_interface = _safe_lookup(device_handle, 2, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_void_p ])
		if query_interface(device_handle, 'IADLXGPU2', ctypes.byref(device_interface_handle)) == 0 and device_interface_handle.value:
			get_drv = _safe_lookup(device_interface_handle, 32, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])
			get_drv(device_interface_handle, ctypes.byref(driver_version))
			release(device_interface_handle)
	except OSError:
		pass

	if not driver_version.value:
		return ctypes.c_char_p(b'AMD Adrenalin')
	return driver_version


def get_device_name(device_handle : ctypes.c_void_p) -> ctypes.c_char_p:
	if not device_handle or device_handle.value == _FALLBACK_SENTINEL or _ADLX_FAILED:
		return ctypes.c_char_p(_ADLBridge.adapter_name)

	device_name = ctypes.c_char_p(bytes())
	try:
		get_name = _safe_lookup(device_handle, 7, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])
		get_name(device_handle, ctypes.byref(device_name))
	except OSError:
		pass

	if not device_name.value:
		return ctypes.c_char_p(_ADLBridge.adapter_name)
	return device_name


def get_device_memory(session_handle : ctypes.c_void_p, device_handle : ctypes.c_void_p) -> ctypes.Structure:
	try:
		device_memory = amd_adlx_module.define_device_memory()
	except Exception:
		device_memory = _FallbackMemory()

	if not device_handle or device_handle.value == _FALLBACK_SENTINEL or _ADLX_FAILED:
		device_memory.memory_total = _ADLBridge.vram_total_mb
		device_memory.memory_used = _ADLBridge.get_vram_used_mb()
		return device_memory

	try:
		get_total_memory = _safe_lookup(device_handle, 11, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])
		get_total_memory(device_handle, ctypes.byref(device_memory, type(device_memory).memory_total.offset))
		performance_monitor_handle = ctypes.c_void_p()
		get_performance_services = _safe_lookup(session_handle, 9, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])

		if get_performance_services(session_handle, ctypes.byref(performance_monitor_handle)) == 0 and performance_monitor_handle.value:
			device_info_handle = ctypes.c_void_p()
			get_current_gpu_metrics = _safe_lookup(performance_monitor_handle, 18, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p ])

			if get_current_gpu_metrics(performance_monitor_handle, device_handle, ctypes.byref(device_info_handle)) == 0 and device_info_handle.value:
				get_memory_used = _safe_lookup(device_info_handle, 12, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])
				get_memory_used(device_info_handle, ctypes.byref(device_memory, type(device_memory).memory_used.offset))
				release(device_info_handle)

			release(performance_monitor_handle)
	except OSError:
		device_memory.memory_total = _ADLBridge.vram_total_mb
		device_memory.memory_used = _ADLBridge.get_vram_used_mb()

	return device_memory


def get_device_temperature(session_handle : ctypes.c_void_p, device_handle : ctypes.c_void_p) -> ctypes.c_double:
	device_temperature = ctypes.c_double(0.0)
	if not device_handle or device_handle.value == _FALLBACK_SENTINEL or _ADLX_FAILED:
		return ctypes.c_double(_ADLBridge.get_temperature())

	try:
		performance_monitor_handle = ctypes.c_void_p()
		get_performance_services = _safe_lookup(session_handle, 9, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])

		if get_performance_services(session_handle, ctypes.byref(performance_monitor_handle)) == 0 and performance_monitor_handle.value:
			device_info_handle = ctypes.c_void_p()
			get_current_gpu_metrics = _safe_lookup(performance_monitor_handle, 18, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p ])

			if get_current_gpu_metrics(performance_monitor_handle, device_handle, ctypes.byref(device_info_handle)) == 0 and device_info_handle.value:
				get_temperature = _safe_lookup(device_info_handle, 7, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])
				get_temperature(device_info_handle, ctypes.byref(device_temperature))
				release(device_info_handle)

			release(performance_monitor_handle)
	except OSError:
		return ctypes.c_double(_ADLBridge.get_temperature())

	return device_temperature


def get_device_utilization(session_handle : ctypes.c_void_p, device_handle : ctypes.c_void_p) -> ctypes.c_double:
	device_utilization = ctypes.c_double(0.0)
	if not device_handle or device_handle.value == _FALLBACK_SENTINEL or _ADLX_FAILED:
		return ctypes.c_double(_ADLBridge.get_utilization())

	try:
		performance_monitor_handle = ctypes.c_void_p()
		get_performance_services = _safe_lookup(session_handle, 9, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])

		if get_performance_services(session_handle, ctypes.byref(performance_monitor_handle)) == 0 and performance_monitor_handle.value:
			device_info_handle = ctypes.c_void_p()
			get_current_gpu_metrics = _safe_lookup(performance_monitor_handle, 18, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p ])

			if get_current_gpu_metrics(performance_monitor_handle, device_handle, ctypes.byref(device_info_handle)) == 0 and device_info_handle.value:
				get_utilization = _safe_lookup(device_info_handle, 4, ctypes.c_int, [ ctypes.c_void_p, ctypes.c_void_p ])
				get_utilization(device_info_handle, ctypes.byref(device_utilization))
				release(device_info_handle)

			release(performance_monitor_handle)
	except OSError:
		return ctypes.c_double(_ADLBridge.get_utilization())

	return device_utilization


def release(interface_handle : ctypes.c_void_p) -> None:
	if not interface_handle or not interface_handle.value or interface_handle.value == _FALLBACK_SENTINEL:
		return
	try:
		release_interface = _safe_lookup(interface_handle, 1, ctypes.c_long, [ ctypes.c_void_p ])
		release_interface(interface_handle)
	except OSError:
		pass


def destroy() -> None:
	# Intentionally keep the ADLX singleton alive across /metrics polls to prevent
	# amdadlx64.dll access violations on rapid ADLXInitialize/ADLXTerminate cycles.
	pass