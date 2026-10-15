import ctypes
import ctypes.util
import platform
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple

ADL_OK = 0
ADL_MAX_PATH = 256
ADL_PMLOG_MAX_SENSORS = 256

# ADLPMLogSensors indices (Overdrive 8 / RDNA / RDNA2 / RDNA3)
ADL_PMLOG_TEMPERATURE_EDGE = 8
ADL_PMLOG_TEMPERATURE_MEM = 9
ADL_PMLOG_INFO_ACTIVITY_GFX = 19
ADL_PMLOG_INFO_ACTIVITY_MEM = 20
ADL_PMLOG_TEMPERATURE_HOTSPOT = 27
ADL_PMLOG_TEMPERATURE_GFX = 28

ADL_MAIN_MALLOC_CALLBACK = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_int)


class ADLAdapterInfo(ctypes.Structure):
	_fields_ =\
	[
		('iSize', ctypes.c_int),
		('iAdapterIndex', ctypes.c_int),
		('strUDID', ctypes.c_char * ADL_MAX_PATH),
		('iBusNumber', ctypes.c_int),
		('iDeviceNumber', ctypes.c_int),
		('iFunctionNumber', ctypes.c_int),
		('iVendorID', ctypes.c_int),
		('strAdapterName', ctypes.c_char * ADL_MAX_PATH),
		('strDisplayName', ctypes.c_char * ADL_MAX_PATH),
		('iPresent', ctypes.c_int),
		('iExist', ctypes.c_int),
		('strDriverPath', ctypes.c_char * ADL_MAX_PATH),
		('strDriverPathExt', ctypes.c_char * ADL_MAX_PATH),
		('strPNPString', ctypes.c_char * ADL_MAX_PATH),
		('iOSDisplayIndex', ctypes.c_int)
	]


class ADLMemoryInfo2(ctypes.Structure):
	_fields_ =\
	[
		('iMemorySize', ctypes.c_longlong),
		('strMemoryType', ctypes.c_char * ADL_MAX_PATH),
		('iMemoryBandwidth', ctypes.c_longlong),
		('iHyperMemorySize', ctypes.c_longlong),
		('iInvisibleMemorySize', ctypes.c_longlong),
		('iVisibleMemorySize', ctypes.c_longlong)
	]


class ADLMemoryInfo(ctypes.Structure):
	_fields_ =\
	[
		('iMemorySize', ctypes.c_longlong),
		('strMemoryType', ctypes.c_char * ADL_MAX_PATH),
		('iMemoryBandwidth', ctypes.c_longlong)
	]


class ADLSingleSensorData(ctypes.Structure):
	_fields_ =\
	[
		('supported', ctypes.c_int),
		('value', ctypes.c_int)
	]


class ADLPMLogDataOutput(ctypes.Structure):
	_fields_ =\
	[
		('size', ctypes.c_int),
		('sensors', ADLSingleSensorData * ADL_PMLOG_MAX_SENSORS)
	]


class ADLTemperature(ctypes.Structure):
	_fields_ =\
	[
		('iSize', ctypes.c_int),
		('iTemperature', ctypes.c_int)
	]


class ADLPMActivity(ctypes.Structure):
	_fields_ =\
	[
		('iSize', ctypes.c_int),
		('iEngineClock', ctypes.c_int),
		('iMemoryClock', ctypes.c_int),
		('iVddc', ctypes.c_int),
		('iActivityPercent', ctypes.c_int),
		('iCurrentPerformanceLevel', ctypes.c_int),
		('iCurrentBusSpeed', ctypes.c_int),
		('iCurrentBusLanes', ctypes.c_int),
		('iMaximumBusLanes', ctypes.c_int),
		('iReserved', ctypes.c_int)
	]


class ADLODNPerformanceStatus(ctypes.Structure):
	_fields_ =\
	[
		('iCoreClock', ctypes.c_int),
		('iMemoryClock', ctypes.c_int),
		('iDCEFClock', ctypes.c_int),
		('iGFXClock', ctypes.c_int),
		('iUVDClock', ctypes.c_int),
		('iVCEClock', ctypes.c_int),
		('iGPUActivityPercent', ctypes.c_int),
		('iCurrentCorePerformanceLevel', ctypes.c_int),
		('iCurrentMemoryPerformanceLevel', ctypes.c_int),
		('iCurrentDCEFPerformanceLevel', ctypes.c_int),
		('iCurrentGFXPerformanceLevel', ctypes.c_int),
		('iUVDPerformanceLevel', ctypes.c_int),
		('iVCEPerformanceLevel', ctypes.c_int),
		('iCurrentBusSpeed', ctypes.c_int),
		('iCurrentBusLanes', ctypes.c_int),
		('iMaximumBusLanes', ctypes.c_int),
		('iVDDC', ctypes.c_int),
		('iVDDCI', ctypes.c_int)
	]


# Keep references to ADL callback buffers so Python GC never collects them early
_ADL_ALLOCATED_BUFFERS : List[Any] = []
_ADL_CONTEXT = ctypes.c_void_p(None)
_ADL_ADAPTERS : Dict[int, ADLAdapterInfo] = {}


@ADL_MAIN_MALLOC_CALLBACK
def _adl_main_memory_alloc(size : int) -> int:
	if size <= 0:
		return 0
	buffer = (ctypes.c_ubyte * size)()
	_ADL_ALLOCATED_BUFFERS.append(buffer)
	return ctypes.addressof(buffer)


def _unwrap_byref(arg : Any) -> Any:
	if hasattr(arg, '_obj'):
		return arg._obj
	if hasattr(arg, 'contents'):
		return arg.contents
	return arg


def _handle_to_adapter_index(device_handle : ctypes.c_void_p) -> int:
	raw_value = device_handle.value if isinstance(device_handle, ctypes.c_void_p) else int(device_handle or 1)
	return int(raw_value or 1) - 1


@lru_cache
def create_static_library() -> Optional[ctypes.CDLL]:
	if platform.system().lower() == 'windows':
		for dll_name in [ 'atiadlxx.dll', 'atiadlxy.dll' ]:
			try:
				library = ctypes.CDLL(dll_name)
				if library:
					return init_adl_ctypes(library)
			except OSError:
				continue
		return None

	library_path = ctypes.util.find_library('amd_smi')

	if library_path:
		library = ctypes.CDLL(library_path)

		if library:
			return init_ctypes(library)

	return None


def init_ctypes(library : ctypes.CDLL) -> ctypes.CDLL:
	library.amdsmi_init.argtypes = [ ctypes.c_uint64 ]
	library.amdsmi_init.restype = ctypes.c_uint32

	library.amdsmi_shut_down.argtypes = []
	library.amdsmi_shut_down.restype = ctypes.c_uint32

	library.amdsmi_get_socket_handles.argtypes = [ ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_void_p) ]
	library.amdsmi_get_socket_handles.restype = ctypes.c_uint32

	library.amdsmi_get_processor_handles.argtypes = [ ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32), ctypes.POINTER(ctypes.c_void_p) ]
	library.amdsmi_get_processor_handles.restype = ctypes.c_uint32

	library.amdsmi_get_gpu_vram_usage.argtypes = [ ctypes.c_void_p, ctypes.c_void_p ]
	library.amdsmi_get_gpu_vram_usage.restype = ctypes.c_uint32

	library.amdsmi_get_gpu_activity.argtypes = [ ctypes.c_void_p, ctypes.c_void_p ]
	library.amdsmi_get_gpu_activity.restype = ctypes.c_uint32

	library.amdsmi_get_gpu_asic_info.argtypes = [ ctypes.c_void_p, ctypes.c_void_p ]
	library.amdsmi_get_gpu_asic_info.restype = ctypes.c_uint32

	library.amdsmi_get_temp_metric.argtypes = [ ctypes.c_void_p, ctypes.c_uint32, ctypes.c_uint32, ctypes.POINTER(ctypes.c_int64) ]
	library.amdsmi_get_temp_metric.restype = ctypes.c_uint32

	return library


def init_adl_ctypes(library : ctypes.CDLL) -> ctypes.CDLL:
	library.ADL2_Main_Control_Create.argtypes = [ ADL_MAIN_MALLOC_CALLBACK, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p) ]
	library.ADL2_Main_Control_Create.restype = ctypes.c_int

	library.ADL2_Main_Control_Destroy.argtypes = [ ctypes.c_void_p ]
	library.ADL2_Main_Control_Destroy.restype = ctypes.c_int

	library.ADL2_Adapter_NumberOfAdapters_Get.argtypes = [ ctypes.c_void_p, ctypes.POINTER(ctypes.c_int) ]
	library.ADL2_Adapter_NumberOfAdapters_Get.restype = ctypes.c_int

	library.ADL2_Adapter_AdapterInfo_Get.argtypes = [ ctypes.c_void_p, ctypes.POINTER(ADLAdapterInfo), ctypes.c_int ]
	library.ADL2_Adapter_AdapterInfo_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_Adapter_MemoryInfo2_Get'):
		library.ADL2_Adapter_MemoryInfo2_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ADLMemoryInfo2) ]
		library.ADL2_Adapter_MemoryInfo2_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_Adapter_MemoryInfo_Get'):
		library.ADL2_Adapter_MemoryInfo_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ADLMemoryInfo) ]
		library.ADL2_Adapter_MemoryInfo_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_Adapter_DedicatedVRAMUsage_Get'):
		library.ADL2_Adapter_DedicatedVRAMUsage_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int) ]
		library.ADL2_Adapter_DedicatedVRAMUsage_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_Adapter_VRAMUsage_Get'):
		library.ADL2_Adapter_VRAMUsage_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_int) ]
		library.ADL2_Adapter_VRAMUsage_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_New_QueryPMLogData_Get'):
		library.ADL2_New_QueryPMLogData_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ADLPMLogDataOutput) ]
		library.ADL2_New_QueryPMLogData_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_OverdriveN_Temperature_Get'):
		library.ADL2_OverdriveN_Temperature_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int) ]
		library.ADL2_OverdriveN_Temperature_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_OverdriveN_PerformanceStatus_Get'):
		library.ADL2_OverdriveN_PerformanceStatus_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ADLODNPerformanceStatus) ]
		library.ADL2_OverdriveN_PerformanceStatus_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_Overdrive5_Temperature_Get'):
		library.ADL2_Overdrive5_Temperature_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ADLTemperature) ]
		library.ADL2_Overdrive5_Temperature_Get.restype = ctypes.c_int

	if hasattr(library, 'ADL2_Overdrive5_CurrentActivity_Get'):
		library.ADL2_Overdrive5_CurrentActivity_Get.argtypes = [ ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ADLPMActivity) ]
		library.ADL2_Overdrive5_CurrentActivity_Get.restype = ctypes.c_int

	def amdsmi_init(flags : Any = 0) -> int:
		global _ADL_CONTEXT
		_ADL_ADAPTERS.clear()
		_ADL_ALLOCATED_BUFFERS.clear()
		_ADL_CONTEXT = ctypes.c_void_p(None)

		if library.ADL2_Main_Control_Create(_adl_main_memory_alloc, 1, ctypes.byref(_ADL_CONTEXT)) != ADL_OK:
			return 1

		num_adapters = ctypes.c_int(0)
		if library.ADL2_Adapter_NumberOfAdapters_Get(_ADL_CONTEXT, ctypes.byref(num_adapters)) != ADL_OK or num_adapters.value <= 0:
			return 0

		adapter_array_type = ADLAdapterInfo * num_adapters.value
		adapter_infos = adapter_array_type()
		ctypes.memset(ctypes.byref(adapter_infos), 0, ctypes.sizeof(adapter_infos))

		if library.ADL2_Adapter_AdapterInfo_Get(_ADL_CONTEXT, adapter_infos, ctypes.sizeof(adapter_infos)) != ADL_OK:
			return 0

		seen_pci_Signature : List[Tuple[int, int, int]] = []
		for i in range(num_adapters.value):
			info = adapter_infos[i]
			if not info.iPresent or info.iBusNumber < 0:
				continue
			# AMD Vendor ID in ADL is either 1002 (decimal representation of 0x1002) or 0x1002 (4098)
			if info.iVendorID not in (1002, 0x1002):
				continue

			pci_sig = (info.iBusNumber, info.iDeviceNumber, info.iFunctionNumber)
			if pci_sig in seen_pci_Signature:
				continue

			seen_pci_Signature.append(pci_sig)
			_ADL_ADAPTERS[info.iAdapterIndex] = info

		return 0

	def amdsmi_shut_down() -> int:
		global _ADL_CONTEXT
		if _ADL_CONTEXT and _ADL_CONTEXT.value:
			library.ADL2_Main_Control_Destroy(_ADL_CONTEXT)
			_ADL_CONTEXT = ctypes.c_void_p(None)
		_ADL_ADAPTERS.clear()
		_ADL_ALLOCATED_BUFFERS.clear()
		return 0

	def amdsmi_get_gpu_asic_info(device_handle : ctypes.c_void_p, product_info_ptr : Any) -> int:
		adapter_index = _handle_to_adapter_index(device_handle)
		product_info = _unwrap_byref(product_info_ptr)
		info = _ADL_ADAPTERS.get(adapter_index)

		if info is not None:
			raw_name = info.strAdapterName.decode('utf-8', errors = 'ignore').strip()
			# Strip redundant 'AMD ' prefix if desired, or keep clean market name
			product_info.market_name = raw_name.encode('utf-8')[:255]
			product_info.vendor_id = info.iVendorID
			product_info.vendor_name = b'AMD'
			product_info.device_id = info.iDeviceNumber
			return 0

		product_info.market_name = b'AMD Radeon GPU'
		product_info.vendor_name = b'AMD'
		return 1

	def amdsmi_get_gpu_vram_usage(device_handle : ctypes.c_void_p, memory_ptr : Any) -> int:
		adapter_index = _handle_to_adapter_index(device_handle)
		device_memory = _unwrap_byref(memory_ptr)
		total_mb = 0
		used_mb = 0

		if hasattr(library, 'ADL2_Adapter_MemoryInfo2_Get'):
			mem_info2 = ADLMemoryInfo2()
			if library.ADL2_Adapter_MemoryInfo2_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(mem_info2)) == ADL_OK and mem_info2.iMemorySize > 0:
				# Add 512 MB rounding margin before integer division in system.py (so 16368 MB -> 16 GB instead of 15 GB)
				total_mb = int((mem_info2.iMemorySize + 512 * 1024 * 1024) // (1024 * 1024))

		if total_mb <= 0 and hasattr(library, 'ADL2_Adapter_MemoryInfo_Get'):
			mem_info = ADLMemoryInfo()
			if library.ADL2_Adapter_MemoryInfo_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(mem_info)) == ADL_OK and mem_info.iMemorySize > 0:
				total_mb = int((mem_info.iMemorySize + 512 * 1024 * 1024) // (1024 * 1024))

		vram_used = ctypes.c_int(0)
		if hasattr(library, 'ADL2_Adapter_DedicatedVRAMUsage_Get'):
			if library.ADL2_Adapter_DedicatedVRAMUsage_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(vram_used)) == ADL_OK and vram_used.value >= 0:
				used_mb = int(vram_used.value)

		if used_mb <= 0 and hasattr(library, 'ADL2_Adapter_VRAMUsage_Get'):
			if library.ADL2_Adapter_VRAMUsage_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(vram_used)) == ADL_OK and vram_used.value >= 0:
				used_mb = int(vram_used.value)

		device_memory.vram_total = max(0, total_mb)
		device_memory.vram_used = max(0, used_mb)
		return 0

	def amdsmi_get_temp_metric(device_handle : ctypes.c_void_p, sensor_type : int, metric : int, temp_ptr : Any) -> int:
		adapter_index = _handle_to_adapter_index(device_handle)
		temp_obj = _unwrap_byref(temp_ptr)
		temp_millidegrees = 0

		# 1. Try Overdrive 8 / RDNA PMLog sensors (reports in degrees C)
		if hasattr(library, 'ADL2_New_QueryPMLogData_Get'):
			pmlog = ADLPMLogDataOutput()
			if library.ADL2_New_QueryPMLogData_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(pmlog)) == ADL_OK:
				for sensor_id in (ADL_PMLOG_TEMPERATURE_EDGE, ADL_PMLOG_TEMPERATURE_GFX, ADL_PMLOG_TEMPERATURE_HOTSPOT):
					sensor = pmlog.sensors[sensor_id]
					if sensor.supported and sensor.value > 0:
						temp_millidegrees = int(sensor.value) * 1000
						break

		# 2. Fallback to OverdriveN (reports in millidegrees C)
		if temp_millidegrees <= 0 and hasattr(library, 'ADL2_OverdriveN_Temperature_Get'):
			odn_temp = ctypes.c_int(0)
			if library.ADL2_OverdriveN_Temperature_Get(_ADL_CONTEXT, adapter_index, 1, ctypes.byref(odn_temp)) == ADL_OK and odn_temp.value > 0:
				temp_millidegrees = int(odn_temp.value if odn_temp.value >= 1000 else odn_temp.value * 1000)

		# 3. Fallback to Overdrive 5 (reports in millidegrees C)
		if temp_millidegrees <= 0 and hasattr(library, 'ADL2_Overdrive5_Temperature_Get'):
			od5_temp = ADLTemperature()
			od5_temp.iSize = ctypes.sizeof(ADLTemperature)
			if library.ADL2_Overdrive5_Temperature_Get(_ADL_CONTEXT, adapter_index, 0, ctypes.byref(od5_temp)) == ADL_OK and od5_temp.iTemperature > 0:
				temp_millidegrees = int(od5_temp.iTemperature if od5_temp.iTemperature >= 1000 else od5_temp.iTemperature * 1000)

		temp_obj.value = temp_millidegrees
		return 0

	def amdsmi_get_gpu_activity(device_handle : ctypes.c_void_p, util_ptr : Any) -> int:
		adapter_index = _handle_to_adapter_index(device_handle)
		utilization = _unwrap_byref(util_ptr)
		gfx_pct = 0
		mem_pct = 0
		got_activity = False

		# 1. Try Overdrive 8 / RDNA PMLog sensors
		if hasattr(library, 'ADL2_New_QueryPMLogData_Get'):
			pmlog = ADLPMLogDataOutput()
			if library.ADL2_New_QueryPMLogData_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(pmlog)) == ADL_OK:
				gfx_sensor = pmlog.sensors[ADL_PMLOG_INFO_ACTIVITY_GFX]
				mem_sensor = pmlog.sensors[ADL_PMLOG_INFO_ACTIVITY_MEM]
				if gfx_sensor.supported:
					gfx_pct = max(0, min(100, int(gfx_sensor.value)))
					got_activity = True
				if mem_sensor.supported:
					mem_pct = max(0, min(100, int(mem_sensor.value)))

		# 2. Fallback to OverdriveN
		if not got_activity and hasattr(library, 'ADL2_OverdriveN_PerformanceStatus_Get'):
			odn_status = ADLODNPerformanceStatus()
			if library.ADL2_OverdriveN_PerformanceStatus_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(odn_status)) == ADL_OK:
				gfx_pct = max(0, min(100, int(odn_status.iGPUActivityPercent)))
				got_activity = True

		# 3. Fallback to Overdrive 5
		if not got_activity and hasattr(library, 'ADL2_Overdrive5_CurrentActivity_Get'):
			od5_activity = ADLPMActivity()
			od5_activity.iSize = ctypes.sizeof(ADLPMActivity)
			if library.ADL2_Overdrive5_CurrentActivity_Get(_ADL_CONTEXT, adapter_index, ctypes.byref(od5_activity)) == ADL_OK:
				gfx_pct = max(0, min(100, int(od5_activity.iActivityPercent)))

		utilization.gfx_activity = gfx_pct
		utilization.umc_activity = mem_pct
		utilization.mm_activity = 0
		return 0

	setattr(library, 'amdsmi_init', amdsmi_init)
	setattr(library, 'amdsmi_shut_down', amdsmi_shut_down)
	setattr(library, 'amdsmi_get_gpu_asic_info', amdsmi_get_gpu_asic_info)
	setattr(library, 'amdsmi_get_gpu_vram_usage', amdsmi_get_gpu_vram_usage)
	setattr(library, 'amdsmi_get_temp_metric', amdsmi_get_temp_metric)
	setattr(library, 'amdsmi_get_gpu_activity', amdsmi_get_gpu_activity)
	setattr(library, '_is_adl_wrapper', True)

	return library


def find_device_handles(amd_smi_library : ctypes.CDLL) -> List[ctypes.c_void_p]:
	device_handles : List[ctypes.c_void_p] = []

	if getattr(amd_smi_library, '_is_adl_wrapper', False):
		for adapter_index in _ADL_ADAPTERS.keys():
			# Offset by +1 so adapter_index 0 never produces a NULL c_void_p(0) handle
			device_handles.append(ctypes.c_void_p(adapter_index + 1))
		return device_handles

	socket_count = ctypes.c_uint32()
	amd_smi_library.amdsmi_get_socket_handles(ctypes.byref(socket_count), ctypes.POINTER(ctypes.c_void_p)())
	socket_handles = (ctypes.c_void_p * socket_count.value)()
	amd_smi_library.amdsmi_get_socket_handles(ctypes.byref(socket_count), socket_handles)

	for socket_index in range(socket_count.value):
		device_count = ctypes.c_uint32()
		amd_smi_library.amdsmi_get_processor_handles(socket_handles[socket_index], ctypes.byref(device_count), ctypes.POINTER(ctypes.c_void_p)())
		processor_handles = (ctypes.c_void_p * device_count.value)()
		amd_smi_library.amdsmi_get_processor_handles(socket_handles[socket_index], ctypes.byref(device_count), processor_handles)

		for device_index in range(device_count.value):
			device_handles.append(ctypes.c_void_p(processor_handles[device_index]))

	return device_handles


def define_product_info() -> ctypes.Structure:
	return type('AMDSMI_ASIC_INFO', (ctypes.Structure,),
	{
		'_pack_': 1,
		'_fields_':
		[
			('market_name', ctypes.c_char * 256),
			('vendor_id', ctypes.c_uint32),
			('vendor_name', ctypes.c_char * 256),
			('subvendor_id', ctypes.c_uint32),
			('device_id', ctypes.c_uint64),
			('rev_id', ctypes.c_uint32),
			('asic_serial', ctypes.c_char * 256),
			('oam_id', ctypes.c_uint32),
			('num_of_compute_units', ctypes.c_uint32),
			('padding', ctypes.c_ubyte * 4),
			('target_graphics_version', ctypes.c_uint64),
			('subsystem_id', ctypes.c_uint32),
			('reserved', ctypes.c_uint32 * 21)
		]
	})()


def define_device_memory() -> ctypes.Structure:
	return type('AMDSMI_VRAM_USAGE', (ctypes.Structure,),
	{
		'_pack_': 1,
		'_fields_':
		[
			('vram_total', ctypes.c_uint32),
			('vram_used', ctypes.c_uint32),
			('reserved', ctypes.c_uint32 * 2)
		]
	})()


def define_device_utilization() -> ctypes.Structure:
	return type('AMDSMI_ENGINE_USAGE', (ctypes.Structure,),
	{
		'_pack_': 1,
		'_fields_':
		[
			('gfx_activity', ctypes.c_uint32),
			('umc_activity', ctypes.c_uint32),
			('mm_activity', ctypes.c_uint32),
			('reserved', ctypes.c_uint32 * 13)
		]
	})()